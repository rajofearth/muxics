# Muxics — Winamp-inspired Electron music player

[![Download Latest Release](https://img.shields.io/badge/Download-Latest%20Release-blue?logo=github)](https://github.com/rajofearth/muxics/releases/latest)
[![License](https://img.shields.io/badge/License-See%20LICENSE-lightgrey)](https://github.com/rajofearth/muxics/blob/main/LICENSE)

A Winamp-inspired cross-platform desktop music player and unofficial YouTube client — supports streaming from YouTube as well as local music playback. Built with Electron & React.

<p align="center">
  <img width="900" alt="app" src="/assets/main.jpeg">
</p>
<p align="center">
  <img height="300" alt="mini player" src="/assets/mini.png">
</p>

Summary
- 🎵 Cross-platform desktop app (macOS, Windows, Linux). Also functions as an unofficial YouTube client for streaming alongside local music playback.
- ⚡ Renderer built with React + Vite. Electron main & preload built with TypeScript (tsup).
- 📦 Packaged with `electron-builder` — artifacts land in `artifacts/` (AppImage / dmg / nsis / zip).

Downloads
- Click the "Download Latest Release" badge above to open the Releases page and download installers for your platform.
- CI produces:
  - macOS (arm64): `.dmg`, `.zip`
  - Windows (x64, arm64): NSIS `.exe`, `.zip`
  - Linux (x64, arm64): `.AppImage`, `.tar.gz`

Developer quickstart
1. Install dependencies:
   - `pnpm install`
2. Run in development:
   - `pnpm dev`
   - This runs Vite + tsup in watch mode and launches Electron with the dev build.
3. Build for production (local):
   - `pnpm run build`   # builds renderer (`dist/`) and electron entrypoints (`dist-electron/`)
   - `pnpm run package` # runs electron-builder and writes installers to `artifacts/`
