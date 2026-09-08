# Building the PPSSPP core

This app links `retrostash/ppsspp-wasm`'s libretro core against `retrostash/RetroArch`
(the WRC fork) to produce `ppsspp_libretro.js`/`.wasm`, then copies those into this
app's `public/js/`.

All commands run inside the `emsdk-3.1.74` Docker container, which has `f:/work`
mounted at `/work`.

## Prerequisites

- The `emsdk-3.1.74` container running (`emscripten/emsdk:3.1.74`).
- `retrostash/ppsspp-wasm` and `retrostash/RetroArch` checked out as siblings of
  this repo under `retrostash/`.

## 1. Build the PPSSPP core

```
docker exec emsdk-3.1.74 sh -c "cd /work/webrcade/retrostash/ppsspp-wasm/libretro && emmake make platform=emscripten -j7"
```

This produces `ppsspp_libretro_emscripten.bc` in `retrostash/ppsspp-wasm/libretro/`.
Despite the `.bc` extension it's a plain `ar` archive (confirmed via `emar t`), not
an LTO bitcode blob — copy/rename it to `.a` so emcc's link step treats it as an
ordinary archive rather than trying to route it through the LTO codepath:

```
docker exec emsdk-3.1.74 sh -c "cp /work/webrcade/retrostash/ppsspp-wasm/libretro/ppsspp_libretro_emscripten.bc /work/webrcade/retrostash/ppsspp-wasm/libretro/emscripten/build/libppsspp_libretro_emscripten.a"
```

## 2. Relink against RetroArch

```
docker exec emsdk-3.1.74 sh -c "cd /work/webrcade/retrostash/RetroArch && emmake make -f Makefile.emscripten.ppsspp LIBRETRO=ppsspp -j7"
```

Produces `ppsspp_libretro.js` and `ppsspp_libretro.wasm` in `retrostash/RetroArch/`.

## 3. Deploy

```
docker exec emsdk-3.1.74 sh -c "cp /work/webrcade/retrostash/RetroArch/ppsspp_libretro.js /work/webrcade/webrcade-app-retro-ppsspp/public/js/ppsspp_libretro.js && cp /work/webrcade/retrostash/RetroArch/ppsspp_libretro.wasm /work/webrcade/webrcade-app-retro-ppsspp/public/js/ppsspp_libretro.wasm"
```

## Notes

- Steps 1-3 are all you need for an incremental rebuild after touching
  `ppsspp-wasm`'s C++ source (`make` only recompiles changed files) — just always
  redo the `.bc` → `.a` copy in step 1 before relinking, since it's a full
  archive replacement, not an incremental one.
- If you only changed `Makefile.emscripten.ppsspp` itself (link flags, exported
  functions, etc.), you can skip straight to step 2.
- `PTHREAD_POOL_SIZE=16` in `Makefile.emscripten.ppsspp` is load-bearing — lower
  values (confirmed at 8) cause real lockups during video/MPEG playback.
