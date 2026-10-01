import {
  BasicRetroAppWrapper,
  Controller,
  Controllers,
  KeyCodeToControlMapping,
  ScriptAudioProcessor,
  DisplayLoop,
  KCODES,
  CIDS,
  LOG,
  // Zip,
} from '@webrcade/app-common';

// WRC - same ANALOG_BIT convention as the N64 apps and
// webrcade-app-retro-flycast: OR'd onto CIDS.UP/DOWN/LEFT/RIGHT, it gives
// that key mapping-table entry a value distinct from the plain digital
// CID, so pollControls() below can tell "this key means move the analog
// stick" apart from "this key means press the D-pad" and react
// accordingly - controllers.getAxisValue()/isControlDown() have no idea
// this bit exists; it's purely this app's own convention to check for.
const ANALOG_BIT = 0x8000;
const ANALOG_UP = ANALOG_BIT | CIDS.UP;
const ANALOG_DOWN = ANALOG_BIT | CIDS.DOWN;
const ANALOG_LEFT = ANALOG_BIT | CIDS.LEFT;
const ANALOG_RIGHT = ANALOG_BIT | CIDS.RIGHT;

// WRC - same fine-positioning modifier scheme as the N64 apps
// (webrcade-app-parallel-n64's index.js), Control-only: reduces the
// analog stick to 50% deflection. Unlike Dreamcast, PSP has a real
// Select button already bound to Shift-Right above, so the second
// (Shift-driven) 25% tier isn't available here without colliding with
// Select - Control alone is as far as this app can go.
const ANALOG_50 = 0x2000;

class PspKeyCodeToControlMapping extends KeyCodeToControlMapping {
  constructor() {
    super({
      [KCODES.ENTER]: CIDS.START,
      [KCODES.SHIFT_RIGHT]: CIDS.SELECT,
      [KCODES.ESCAPE]: CIDS.ESCAPE,
      [KCODES.ARROW_UP]: ANALOG_UP,
      [KCODES.ARROW_DOWN]: ANALOG_DOWN,
      [KCODES.ARROW_RIGHT]: ANALOG_RIGHT,
      [KCODES.ARROW_LEFT]: ANALOG_LEFT,
      [KCODES.I]: CIDS.UP,
      [KCODES.J]: CIDS.LEFT,
      [KCODES.K]: CIDS.DOWN,
      [KCODES.L]: CIDS.RIGHT,
      [KCODES.S]: CIDS.Y, // Triangle
      [KCODES.X]: CIDS.B, // Circle
      [KCODES.Z]: CIDS.A, // Cross
      [KCODES.A]: CIDS.X, // Square
      [KCODES.Q]: CIDS.LBUMP, // L
      [KCODES.W]: CIDS.RBUMP, // R
      [KCODES.CONTROL_RIGHT]: ANALOG_50,
      [KCODES.CONTROL_LEFT]: ANALOG_50,
    });
  }

  // This app maps both Control keys to Analog 50% above -- a real
  // gameplay modifier. The shared Ctrl+Shift pause sequence collides with
  // holding Control (analog) and Shift (Select) together, so it's
  // disabled for this app only. The literal Escape key (still mapped
  // above) and the gamepad pause combo (SL+X, LT+LA) are unaffected.
  isEscapeKeySequenceEnabled() {
    return false;
  }
}

export class Emulator extends BasicRetroAppWrapper {

  // WRC - required by RetroAppWrapper itself (retrowrapper/index.js:914,
  // `this.saveStatePath = ${this.saveStatePrefix}${this.SAVE_NAME}`) to
  // compute saveStatePath at boot - not specific to the old game.srm
  // save mechanism (removed below), still load-bearing for the SAVEDATA
  // path built from it.
  SAVE_NAME = 'sav';
  SAVEDATA_DIR = '/home/web_user/retroarch/userdata/saves/PSP/SAVEDATA';

  constructor(app, debug = false) {
    super(app, debug);

    // TODO - diagnostic left in from the PPSSPP intermittent lockup
    // investigation; the actual root cause was found and fixed (FFmpeg's
    // internal codec threading racing PPSSPP's own ThreadManager pool -
    // see MediaEngine.cpp's threads=1 fix), so this is no longer needed
    // for active investigation. Shipped anyway since the overhead is low
    // and it's been running fine for users - but it's still logging every
    // pthread_create()-driven Worker spawn/terminate with a timestamp and
    // stack trace to the console on every game. Remove once there's a
    // clean window to do a production rebuild without it.
    // Patches the global Worker constructor (same monkey-patch technique
    // used for WebAssembly.Memory.prototype.grow earlier this session),
    // before the Emscripten module (and its pthread pool) ever instantiates.
    if (!window.__wrcWorkerPatched) {
      window.__wrcWorkerPatched = true;
      const OrigWorker = window.Worker;
      let workerCount = 0;
      const activeWorkers = new Set();
      function WrappedWorker(...args) {
        const id = ++workerCount;
        const ts = performance.now().toFixed(1);
        activeWorkers.add(id);
        console.log(`[WRC-THREAD] Worker #${id} created @ ${ts}ms - ${activeWorkers.size} active - src=${args[0]}`);
        console.trace(`[WRC-THREAD] Worker #${id} creation site`);
        const w = new OrigWorker(...args);
        const origTerminate = w.terminate.bind(w);
        w.terminate = (...targs) => {
          activeWorkers.delete(id);
          console.log(`[WRC-THREAD] Worker #${id} terminated @ ${performance.now().toFixed(1)}ms - ${activeWorkers.size} active`);
          return origTerminate(...targs);
        };
        return w;
      }
      WrappedWorker.prototype = OrigWorker.prototype;
      window.Worker = WrappedWorker;
    }

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
  // Gamepad face/D-pad button input needs no per-app mapping here - CIDS.A/
  // B/X/Y etc. already map generically from a real gamepad via
  // StandardPadMapping, forwarded via wrc_set_input() - see libretro.cpp
  // for the PSP-side CTRL_* translation (positional Cross/Circle/Square/
  // Triangle). The right analog stick is NOT passed through as real analog
  // (see pollControls() below for why - PPSSPP's CTRL_STICK_RIGHT extension
  // isn't read by any game we've found); it's converted to face-button
  // presses there instead.
  createControllers() {
    this.keyToControlMapping = new PspKeyCodeToControlMapping();
    return new Controllers([
      new Controller(this.keyToControlMapping),
      new Controller(),
      new Controller(),
      new Controller(),
    ]);
  }

  // WRC - full copy of RetroAppWrapper's own default pollControls()
  // (webrcade-app-common/src/app/retrowrapper/index.js), plus the
  // ANALOG_BIT override block at the end. This app previously relied
  // entirely on that shared default (see the comment above
  // createControllers()) - overriding it here, rather than adding
  // ANALOG_BIT support to the shared base, keeps the change scoped to
  // this app only, matching how webrcade-app-retro-flycast and the N64
  // apps each already do their own per-app pollControls() rather than
  // touching code every other RetroAppWrapper-based app also depends on.
  // Keep in sync with the base method if that ever changes.
  pollControls() {
    const { analogMode, CONTROLLER_COUNT, controllers, keyToControlMapping } = this;

    controllers.poll();

    const isAnalog = analogMode;

    // WRC - see BasicRetroAppWrapper's own pollControls() for the
    // reference version of this scoping: each button is only watched if
    // something downstream actually cares about its hold-time, so an
    // unneeded one (this app leaves Start/Select-hack both off) doesn't
    // pollute the shared escapeCount used by all three gates below.
    const watchLtrig = this.isEscapeHackEnabled();
    const watchLanalog = this.isEscapeHackEnabled() || this.isSelectEscapeHackEnabled();
    const watchRtrig = this.isSelectEscapeHackEnabled() || this.isStartEscapeHackEnabled();
    const watchRanalog = this.isStartEscapeHackEnabled();

    if (
      (watchLtrig && controllers.isControlDown(0, CIDS.LTRIG)) ||
      (watchLanalog && controllers.isControlDown(0, CIDS.LANALOG)) ||
      (watchRtrig && controllers.isControlDown(0, CIDS.RTRIG)) ||
      (watchRanalog && controllers.isControlDown(0, CIDS.RANALOG))
    ) {
      this.escapeCount = this.escapeCount === -1 ? 0 : this.escapeCount + 1;
    } else {
      this.escapeCount = -1;
    }

    for (let i = 0; i < CONTROLLER_COUNT; i++) {
      let input = 0;

      // WRC - raw "haven't been held too long yet" signal, shared by all
      // three isXEscapeHackEnabled() gates below (see
      // BasicRetroAppWrapper's own pollControls() for the reference
      // version of this split - PSP has no real button/game function
      // that collides with RT+LA/RT+RA the way PSX's R2+L3/R3 does, so
      // this app just uses the inherited false defaults for Start/Select
      // rather than overriding them).
      const escapeHackOk = (this.escapeCount === -1 || this.escapeCount < 60);
      const escapeOk = !this.isEscapeHackEnabled() || escapeHackOk;
      const startOk = !this.isStartEscapeHackEnabled() || escapeHackOk;
      const selectOk = !this.isSelectEscapeHackEnabled() || escapeHackOk;

      // Hack to reduce likelihood of accidentally bringing up menu
      if (
        controllers.isControlDown(0 /*i*/, CIDS.ESCAPE) && escapeOk
      ) {
        if (this.handleEscape(controllers)) {
            return;
        } else if (this.pause(true)) {
          controllers
            .waitUntilControlReleased(0 /*i*/, CIDS.ESCAPE)
            .then(() => this.showPauseMenu());
          return;
        }
      }

      if (controllers.isControlDown(i, CIDS.UP, !isAnalog)) {
        input |= this.INP_UP;
      } else if (controllers.isControlDown(i, CIDS.DOWN, !isAnalog)) {
        input |= this.INP_DOWN;
      }
      if (controllers.isControlDown(i, CIDS.RIGHT, !isAnalog)) {
        input |= this.INP_RIGHT;
      } else if (controllers.isControlDown(i, CIDS.LEFT, !isAnalog)) {
        input |= this.INP_LEFT;
      }
      if (controllers.isControlDown(i, CIDS.START) && startOk) {
        input |= this.INP_START;
      }
      if (controllers.isControlDown(i, CIDS.SELECT) && selectOk) {
        input |= this.INP_SELECT;
      }
      if (controllers.isControlDown(i, CIDS.A)) {
        input |= this.INP_A;
      }
      if (controllers.isControlDown(i, CIDS.B)) {
        input |= this.INP_B;
      }
      if (controllers.isControlDown(i, CIDS.X)) {
        input |= this.INP_X;
      }
      if (controllers.isControlDown(i, CIDS.Y)) {
        input |= this.INP_Y;
      }
      if (controllers.isControlDown(i, CIDS.LBUMP)) {
        input |= this.INP_LBUMP;
      }
      if (controllers.isControlDown(i, CIDS.RBUMP)) {
        input |= this.INP_RBUMP;
      }
      // WRC - INP_LTRIG/INP_RTRIG deliberately not forwarded: PSP has no
      // real L2/R2, and the core itself ORs them into the exact same L/R
      // bit as INP_LBUMP/INP_RBUMP (see retrostash/ppsspp-wasm/libretro/
      // libretro.cpp's ExtractButtons()) - undocumented in this app's own
      // pause-menu controls tab too, so dropping them here changes
      // nothing a player could rely on.
      if (controllers.isControlDown(i, CIDS.LANALOG)) {
        input |= this.INP_LTHUMB;
      }
      if (controllers.isControlDown(i, CIDS.RANALOG)) {
        input |= this.INP_RTHUMB;
      }

      let analog0x = controllers.getAxisValue(i, 0, true);
      let analog0y = controllers.getAxisValue(i, 0, false);
      const analog1x = controllers.getAxisValue(i, 1, true);
      const analog1y = controllers.getAxisValue(i, 1, false);

      // WRC - real PSP hardware has no second analog stick, and in
      // practice no game we've found actually reads PPSSPP's
      // CTRL_STICK_RIGHT extension (forwarding analog1x/analog1y straight
      // through did nothing). Instead, treat right-stick deflection as
      // face-button presses (diamond layout: up=Y/Triangle, down=A/Cross,
      // left=X/Square, right=B/Circle) - useful for games (e.g. light-gun
      // titles) whose crosshair/cursor only responds to face buttons.
      const RANALOG_THRESHOLD = 0.5;
      if (analog1y < -RANALOG_THRESHOLD) {
        input |= this.INP_Y;
      } else if (analog1y > RANALOG_THRESHOLD) {
        input |= this.INP_A;
      }
      if (analog1x < -RANALOG_THRESHOLD) {
        input |= this.INP_X;
      } else if (analog1x > RANALOG_THRESHOLD) {
        input |= this.INP_B;
      }

      // WRC - see BasicRetroAppWrapper's own pollControls() for the
      // reference version of this - getAxisValue() only ever
      // reads a real gamepad's axes, it has no idea these keyboard keys
      // exist, so this app overrides the left-stick axis values by hand
      // when they're down. Player 1 (keyboard) only, matching the same
      // i === 0 gate flycast/N64 use for the identical pattern.
      if (i === 0) {
        // WRC - fine-positioning modifier (see ANALOG_50's definition
        // above): Control held reduces the full-deflection multiplier
        // below, same math as the N64 apps' pollControls() (Control-only
        // here, since Shift is already Select on this app).
        const multiplier = keyToControlMapping.isControlDown(ANALOG_50) ? 0.5 : 1;

        if (keyToControlMapping.isControlDown(ANALOG_RIGHT)) analog0x = multiplier;
        if (keyToControlMapping.isControlDown(ANALOG_LEFT)) analog0x = -multiplier;
        if (keyToControlMapping.isControlDown(ANALOG_UP)) analog0y = -multiplier;
        if (keyToControlMapping.isControlDown(ANALOG_DOWN)) analog0y = multiplier;
      }

      let controller = this.getControllerIndex(i);
      this.sendInput(
        controller,
        input,
        analog0x,
        analog0y,
        0,
        0,
      );
    }
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

    // Touch/mouse/keyboard interaction detection + on-screen touch overlay
    // gating is inherited from BasicRetroAppWrapper.
    super.onFrame();
  }

  // Base class default pauses on any tap anywhere on screen -- redundant
  // (and disruptive) now that there's a dedicated Pause button in the
  // touch overlay. Same override every other TouchOverlay app uses for
  // the same reason.
  createTouchListener() {}

  preInit(FS) {
    FS.mkdir('/home/web_user/retroarch/userdata/system/PPSSPP');
  }

  // WRC - assets.zip is PPSSPP's own full assets/ directory (flash0 fonts,
  // ppge_atlas.zim, compat.ini, etc), zipped as-is and dropped in public/.
  // Replaces the old approach of hand-picking individual files to
  // base64-embed in files.js (which kept missing ones a specific dialog
  // needed - see the ltn1-ltn15 fix attempt). Once this is confirmed
  // working, the zip's own contents can be trimmed down to just what's
  // actually needed instead of shipping the whole PPSSPP asset set.
  getExtractPath(path) {
    // The zip's entries are all under a top-level "assets/" folder (the
    // directory name itself got zipped, not just its contents) - strip that
    // so contents land directly under the PPSSPP system directory, matching
    // upstream PPSSPP's own expected "system/PPSSPP/flash0/..." layout.
    return path.replace(/^assets\//, '');
  }

  async onWriteAdditionalFiles() {
    const { FS } = window;
    const response = await fetch('assets.zip');
    const bytes = new Uint8Array(await response.arrayBuffer());
    await this.extractArchive(
      FS,
      '/home/web_user/retroarch/userdata/system/PPSSPP',
      bytes,
      this.DEFAULT_MAX_EXTRACT_SIZE,
      null
    );
    await super.onWriteAdditionalFiles();
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

    if (!started) {
      return;
    }

    // Save to files
    Module._cmd_savefiles();

    // WRC - PSP's actual in-game "Save Game" data lives in a directory tree
    // (PSP_GAME's save format: SAVEDATA/<gameId+saveId>/PARAM.SFO, actual
    // save file(s), icons, etc. - a dynamic, per-game set of files). Walk
    // it recursively (same shape as webrcade-app-retro-dosbox-pure's saveState() -
    // FS.readdir + FS.stat mode-bit checks) and hand the whole tree to
    // SaveManager as one flat {name, content} array; it hashes each file
    // individually via checkFilesChanged() to skip saving when nothing
    // changed, and zips the whole tree using each entry's name (which
    // includes the relative subdirectory path) as its path inside the zip.
    try {
      const { SAVEDATA_DIR } = this;
      const savedataFiles = [];

      const walkFiles = (path) => {
        let dir;
        try {
          dir = FS.readdir(path);
        } catch (e) {
          return;
        }
        dir.forEach(entry => {
          if (entry === '.' || entry === '..') return;
          const fullPath = path + '/' + entry;
          const stat = FS.stat(fullPath);
          const isDirectory = (stat.mode & 0o40000) !== 0;
          const isFile = (stat.mode & 0o100000) !== 0;
          if (isDirectory) {
            walkFiles(fullPath);
          } else if (isFile) {
            const s = FS.readFile(fullPath);
            if (s) {
              savedataFiles.push({
                name: fullPath.substring(SAVEDATA_DIR.length + 1),
                content: s,
              });
            }
          }
        });
      };
      walkFiles(SAVEDATA_DIR);

      if (savedataFiles.length > 0) {
        if (await this.getSaveManager().checkFilesChanged(savedataFiles)) {
          const totalBytes = savedataFiles.reduce((sum, f) => sum + f.content.length, 0);

          // WRC - SaveManager.save() zips internally but doesn't return the
          // zip or its size, so measuring the actual compressed size means
          // zipping locally too (same Zip helper SaveManager itself uses)
          // just for this log - a real, if small, redundant compression
          // pass on every save. Was useful for checking real-world save
          // sizes during development; commented out rather than removed
          // since it's cheap to re-enable if that's needed again.
          // let compressedBytes = null;
          // try {
          //   const zip = new Zip();
          //   const zipBlob = await zip.zipFiles(
          //     savedataFiles.map(f => ({
          //       name: f.name,
          //       content: f.content instanceof Blob ? f.content : new Blob([f.content]),
          //     }))
          //   );
          //   compressedBytes = zipBlob.size;
          // } catch (e) {
          //   LOG.error('Error measuring PSP save data zip size: ' + e);
          // }

          const toKB = (bytes) => (bytes / 1024).toFixed(1) + 'KB';
          LOG.info(
            `Saving PSP save data: ${savedataFiles.length} file(s), ` +
            `${toKB(totalBytes)} uncompressed`
            // + (compressedBytes !== null ? `, ${toKB(compressedBytes)} compressed (zip)` : '')
          );

          await this.getSaveManager().save(
            saveStatePath,
            savedataFiles,
            this.saveMessageCallback,
          );
        }
      }
    } catch (e) {
      LOG.error('Error persisting PSP save data: ' + e);
    }
  }

  async loadState() {
    const { saveStatePath } = this;
    const { FS } = window;

    // WRC - restore the PSP save-data directory tree saved in saveState()
    try {
      const { SAVEDATA_DIR } = this;
      const savedataFiles = await this.getSaveManager().load(
        saveStatePath,
        this.loadMessageCallback,
      );

      if (savedataFiles) {
        for (let i = 0; i < savedataFiles.length; i++) {
          const f = savedataFiles[i];
          const outPath = `${SAVEDATA_DIR}/${f.name}`;
          const destDir = outPath.substring(0, outPath.lastIndexOf('/'));
          this.createDirectories(FS, destDir);
          FS.writeFile(outPath, f.content);
        }

        LOG.info(`Restored PSP save data: ${savedataFiles.length} file(s)`);

        // Cache the initial files
        await this.getSaveManager().checkFilesChanged(savedataFiles);
      }
    } catch (e) {
      LOG.error('Error loading PSP save data: ' + e);
    }
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
