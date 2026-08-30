import {
  Controller,
  Controllers,
  KeyCodeToControlMapping,
  ScriptAudioProcessor,
  RetroAppWrapper,
  DisplayLoop,
  KCODES,
  CIDS,
  LOG,
} from '@webrcade/app-common';

import {
  ppge_atlas, jpn0, ltn0
} from "./files"

export class Emulator extends RetroAppWrapper {

  GAME_SRAM_NAME = 'game.srm';
  SAVE_NAME = 'sav';

  constructor(app, debug = false) {
    super(app, debug);
    this.analogMode = true;

    this.audioStarted = 0;

    // Fractional sample carry (for 735.25 - slightly above the exact
    // 44100/60=735 to keep the ring buffer fed ahead, matching snes9x's
    // same trick for 48000Hz)
    this.audioCarry = 0;

    this.total = 0;
    this.count = 0;

    this.audioCallback = (offset, length) => {
      /*
      // length = incoming frames (mono)
      this.count++;

      if (this.count === 60) {
        this.total = 0;
        this.count = 0;
      }

      // ---- target frames this callback ----
      // WRC - use the AudioContext's actual realized sample rate, not a
      // hardcoded 44100: browsers don't always honor an explicit
      // `new AudioContext({sampleRate})` request (commonly landing on the
      // device's native 48000 instead), and PPSSPP's HLE audio mixer output
      // is a fixed 44100 (real PSP hardware rate - see hwSampleRate in
      // Core/HLE/__sceAudio.cpp) regardless of what the browser gives us -
      // so pacing against the wrong assumed rate here is a real pitch/speed bug.
      const exactFrames = (44100 + 15) / 60;
      const framesWithCarry = exactFrames + this.audioCarry;
      const outFrames = Math.floor(framesWithCarry);
      this.audioCarry = framesWithCarry - outFrames;

      console.log(length + "," + outFrames)

      // ---- input samples (stereo interleaved) ----
      const inSamples = length << 1;
      const input = new Int16Array(
        window.Module.HEAP16.buffer,
        offset,
        inSamples
      );

      // ---- output buffer (stereo interleaved) ----
      const outSamples = outFrames << 1;
      const output = new Int16Array(outSamples);

      // ---- frame walking resampler (no timing drift) ----
      const step = length / outFrames;

      let srcFrame = 0;
      for (let i = 0; i < outFrames; i++) {
        const si = (srcFrame | 0) << 1;

        output[i * 2] = input[si];
        output[i * 2 + 1] = input[si + 1];

        srcFrame += step;
      }

      this.total += (outSamples >> 1);


      this.audioProcessor.storeSoundCombinedInput(
        output,
        2,
        outSamples,
        0,
        32768
      );
      */

      const input = new Int16Array(
        window.Module.HEAP16.buffer,
        offset,
        length << 1
      );
      this.audioProcessor.storeSoundCombinedInput(
        input,
        2,
        length << 1,
        0,
        32768
      );
    };
  }

  // WRC - keyboard layout matches webrcade-app-beetle-psx's exactly (PSX
  // shares PSP's Triangle/Circle/Cross/Square face buttons) - Z/X/A/S in a
  // positional inverted-T matching the physical Cross/Circle/Square/Triangle
  // diamond, not a letter/color match. PSP has no analog trigger separate
  // from L/R (unlike PSX's L2/R2), so just one L/R key pair (Q/W) is needed.
  //
  // Gamepad input needs no per-app mapping here - CIDS.A/B/X/Y etc. already
  // map generically from a real gamepad via StandardPadMapping, and
  // RetroAppWrapper's own (un-overridden) pollControls()/sendInput() already
  // reads both analog sticks and the full WRC INP_* button set into
  // wrc_set_input() - see the new wrc_set_input() in libretro.cpp for the
  // PSP-side CTRL_* translation (positional Cross/Circle/Square/Triangle,
  // right stick passed straight through to CTRL_STICK_RIGHT for twin-stick
  // games, matching retro_input()'s own existing convention).
  createControllers() {
    this.keyToControlMapping = new KeyCodeToControlMapping({
      [KCODES.ENTER]: CIDS.START,
      [KCODES.SHIFT]: CIDS.SELECT,
      [KCODES.ESCAPE]: CIDS.ESCAPE,
      [KCODES.ARROW_UP]: CIDS.UP,
      [KCODES.ARROW_DOWN]: CIDS.DOWN,
      [KCODES.ARROW_RIGHT]: CIDS.RIGHT,
      [KCODES.ARROW_LEFT]: CIDS.LEFT,
      [KCODES.S]: CIDS.Y, // Triangle
      [KCODES.X]: CIDS.B, // Circle
      [KCODES.Z]: CIDS.A, // Cross
      [KCODES.A]: CIDS.X, // Square
      [KCODES.Q]: CIDS.LBUMP, // L
      [KCODES.W]: CIDS.RBUMP, // R
    });
    return new Controllers([
      new Controller(this.keyToControlMapping),
      new Controller(),
      new Controller(),
      new Controller(),
    ]);
  }

  createAudioProcessor() {
    return new ScriptAudioProcessor(
      2,
      44100,
      8192 + 4096,
      2048
    ).setDebug(this.debug);
  }

  onFrame() {
    if (this.audioStarted !== -1) {
      if (this.audioStarted > 1) {
        this.audioStarted = -1;
        // Start the audio processor
        this.audioProcessor.start();
      } else {
        this.audioStarted++;
      }
    }
  }

  preInit(FS) {
    FS.mkdir('/home/web_user/retroarch/userdata/system/PPSSPP');
    FS.mkdir('/home/web_user/retroarch/userdata/system/PPSSPP/flash0');
    FS.mkdir('/home/web_user/retroarch/userdata/system/PPSSPP/flash0/font');

    const base64ToUint8Array = (b64) => {
      const bin = atob(b64);
      return Uint8Array.from(bin, c => c.charCodeAt(0));
    }

    FS.writeFile(
      "/home/web_user/retroarch/userdata/system/PPSSPP/ppge_atlas.zim",
      base64ToUint8Array(ppge_atlas)
    );

    FS.writeFile(
      "/home/web_user/retroarch/userdata/system/PPSSPP/flash0/font/jpn0.pgf",
      base64ToUint8Array(jpn0)
    );

    FS.writeFile(
      "/home/web_user/retroarch/userdata/system/PPSSPP/flash0/font/ltn0.pgf",
      base64ToUint8Array(ltn0)
    );
  }

  getScriptUrl() {
    return 'js/ppsspp_libretro.js';
  }

  getPrefs() {
    return this.prefs;
  }

  // getRaConfigContents() {
  //   return (
  //     "video_threaded = \"false\"\n" +
  //     "video_vsync = \"false\"\n" +
  //     "video_driver = \"gl\"\n" +
  //     "audio_latency = \"192\"\n" +
  //     "audio_buffer_size = \"8192\"\n" +
  //     "audio_sync = \"false\"\n" +
  //     "audio_driver = \"sdl2\"\n"
  //   )
  // }

  // WRC - audio_driver deliberately omitted: this build has no SDL support
  // (HAVE_SDL/HAVE_SDL2 are both 0), so requesting "sdl" here just made
  // RetroArch log "Couldn't find any audio driver named 'sdl'" and fall
  // back to rwebaudio anyway - matching flycast's own getRaConfigContents(),
  // which never sets audio_driver at all and lets RetroArch's default/
  // first-available logic pick rwebaudio directly.
  getRaConfigContents() {
    return (
      "video_threaded = \"false\"\n" +
      "video_vsync = \"false\"\n" +
      "video_driver = \"null\"\n" +
      "audio_latency = \"256\"\n" +
      "audio_buffer_size = \"16384\"\n"
    )
  }

  createDisplayLoop(debug) {
    const loop = new DisplayLoop(
      60,
      false, // vsync
      debug, // debug
      true,
      true
    );
    //loop.setAdjustTimestampEnabled(false);
    return loop;
  }

  async saveState() {
    const { saveStatePath, started } = this;
    const { FS, Module } = window;

    try {
      if (!started) {
        return;
      }

      // Save to files
      Module._cmd_savefiles();

      let path = '';
      const files = [];
      let s = null;

      path = `/home/web_user/retroarch/userdata/saves/${this.GAME_SRAM_NAME}`;
      LOG.info('Checking: ' + path);
      try {
        s = FS.readFile(path);
        if (s) {
          LOG.info('Found save file: ' + path);
          files.push({
            name: this.SAVE_NAME,
            content: s,
          });
        }
      } catch (e) {}

      if (files.length > 0) {
        if (await this.getSaveManager().checkFilesChanged(files)) {
          await this.getSaveManager().save(
            saveStatePath,
            files,
            this.saveMessageCallback,
          );
        }
      } else {
        await this.getSaveManager().delete(path);
      }
    } catch (e) {
      LOG.error('Error persisting save state: ' + e);
    }
  }

  async loadState() {
    const { saveStatePath } = this;
    const { FS } = window;

    // Write the save state (if applicable)
    try {
      // Load
      const files = await this.getSaveManager().load(
        saveStatePath,
        this.loadMessageCallback,
      );

      if (files) {
        for (let i = 0; i < files.length; i++) {
          const f = files[i];
          if (f.name === this.SAVE_NAME) {
            LOG.info(`writing ${this.GAME_SRAM_NAME} file`);
            FS.writeFile(
              `/home/web_user/retroarch/userdata/saves/${this.GAME_SRAM_NAME}`,
              f.content,
            );
          }
        }

        // Cache the initial files
        await this.getSaveManager().checkFilesChanged(files);
      }
    } catch (e) {
      LOG.error('Error loading save state: ' + e);
    }
  }

  getRamExpansion() {
    const props = this.getProps();
    const expansion = props.ramExpansion;
    if (expansion) {
      return expansion;
    }
    return 0;
  }

  applyGameSettings() {
    // const { Module } = window;
    // const props = this.getProps();
    // let options = 0;

    // if (options) {
    //   Module._wrc_set_options(options);
    // }
  }

  getDefaultAspectRatio() {
    return 1.778;
  }

  resizeScreen(canvas) {
    this.canvas = canvas;
    this.updateScreenSize();
  }

  getUseNewResizeStyle() {
    return true;
  }

  getShotAspectRatio() { return this.getDefaultAspectRatio(); }
}
