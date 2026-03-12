# Winamp Player – Electrobun & React Demo

A Winamp-inspired music player app built with [Electrobun](https://github.com/blackboardsh/electrobun), React, and Tailwind CSS.

<img width="1092" height="917" alt="image" src="/assets/main.jpeg" />
<img width="380" height="400" alt="image" src="/assets/mini.png" />


## Features

- 🎵 **Cross-platform desktop UI** with a nostalgic Winamp look
- ⚡️ **React + Vite + Tailwind** for hot-reload frontend development
- 🍰 **Electrobun**: Lightning-fast Bun-based desktop framework
- 🩳 **Separation of concerns**: Bun main process + web-based renderer

## Quickstart

1. **Install dependencies**  
   ```bash
   bun install
   ```

2. **Start in development mode**  
   ```bash
   bun run dev
   ```

3. **Build for production**  
   ```bash
   bun run start
   ```

> Build output lands in `dist/`, and static assets are copied to the main view for Electron-style delivery.

### Windows app icon

Electrobun’s built-in icon embedding fails on Windows due to a path bug. A post-package script patches the icon when possible. If the taskbar still shows the default icon:

1. Close the app completely.
2. Run `pnpm patch:icons`.
3. Start the app again with `pnpm start`.

## Customization & Ideas

Ready to keep going? Try these:

- Implement tracklist & playback using React hooks
- Add file open dialogs to import music (via Bun)
- Add system tray support and native menus
- Connect Bun <-> React via IPC for enhanced interactivity

## Resources

- [Electrobun Docs](https://docs.electrobun.dev/)
- [Electrobun Examples](https://github.com/blackboardsh/electrobun/tree/main/playground)
- [Electrobun GitHub](https://github.com/blackboardsh/electrobun)
- [Vite](https://vitejs.dev/), [React](https://react.dev/), [Tailwind CSS](https://tailwindcss.com/)

---

Happy hacking! 🦄
