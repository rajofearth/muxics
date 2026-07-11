# Winamp Player (Muxics)

Electron desktop application — a modern music player built with Electron, Vite, React, and Tailwind.

## Agent skills

### Issue tracker

GitHub Issues via the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Domain docs

Single-context layout — one `CONTEXT.md` + `docs/adr/` at the repo root. See `docs/agents/domain.md`.

## Conventions

Use Electron main/preload patterns with `contextBridge`, `ipcMain`, and `ipcRenderer`. Do not reintroduce Electrobun or Bun runtime APIs.

### Import patterns

- Main process: `import { BrowserWindow } from "electron"`
- Preload: `import { contextBridge, ipcRenderer } from "electron"`
- Renderer bridge: import the typed desktop bridge from `src/mainview/desktop.ts`

Use `BrowserWindow.loadURL()` in dev and bundled `dist/index.html` in production. Renderer assets are built by Vite to `dist/`, and Electron entrypoints are built by tsup to `dist-electron/`.

### Documentation

- Electron docs: https://www.electronjs.org/docs/latest
- electron-builder docs: https://www.electron.build/
- Domain context: `CONTEXT.md`

### Packaging

Handled by `electron-builder`, with artifacts written to `artifacts/`.

## Subagent orchestration

When a task touches multiple independent areas, delegate to sub-agents in parallel:

- **Parallel exploration** — spawn agents to read different parts of the codebase simultaneously (e.g. backend + renderer + config) before making changes.
- **Parallel implementation** — when a feature spans disconnected modules, split the work into disjoint subtasks with non-overlapping file writes and run them concurrently.
- **Research delegation** — offload background investigation (reading docs, tracing a call chain, grepping for patterns) to a sub-agent so the main thread stays responsive.
- **Review delegation** — spawn a sub-agent to review changes while the main thread continues on the next task.

Use `spawn_agent` for all delegation. Include full context (file paths, constraints, expected output) in the message — sub-agents don't see your conversation history. Prefer narrow, concrete subtasks over broad asks. Reuse `session_id` for follow-ups on the same sub-problem.
