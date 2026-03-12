# Winamp Player – Electron & React Demo

A Winamp-inspired music player app built with Electron, React, and Tailwind CSS.

<img width="1092" height="917" alt="image" src="/assets/main.jpeg" />
<img width="380" height="400" alt="image" src="/assets/mini.png" />


## Features

- 🎵 **Cross-platform desktop UI** with a nostalgic Winamp look
- ⚡️ **React + Vite + Tailwind** for hot-reload frontend development
- 🖥️ **Electron main + preload** with a typed desktop bridge
- 🩳 **Separation of concerns**: Node-powered desktop backend + web-based renderer

## Quickstart

1. **Install dependencies**  
   ```bash
   pnpm install
   ```

2. **Start in development mode**  
   ```bash
   pnpm dev
   ```

3. **Build for production**  
   ```bash
   pnpm package
   ```

> Renderer assets build into `dist/`, Electron entrypoints build into `dist-electron/`, and packaged artifacts land in `artifacts/`.

## Customization & Ideas

Ready to keep going? Try these:

- Implement tracklist & playback using React hooks
- Add file open dialogs to import music from the desktop shell
- Add system tray support and native menus
- Expand the Electron desktop bridge with more native features

## Resources

- [Electron Docs](https://www.electronjs.org/docs/latest)
- [electron-builder Docs](https://www.electron.build/)
- [Vite](https://vitejs.dev/), [React](https://react.dev/), [Tailwind CSS](https://tailwindcss.com/)
