# Visualizer persistence + keybinds help

## 1. Persist visualizer mode across restarts

**Problem:** `useUiStore.visualizerMode` (`src/renderer/store/ui.ts`) resets to `'bars'` on every app launch. User has to re-cycle (V key) to their preferred mode every session.

**Fix:** Persist to `localStorage`.

- Read initial state from `localStorage.getItem('waverr:visualizerMode')` on store init, falling back to `'bars'` if missing or not a valid `VisualizerMode`.
- On `cycleVisualizer()`, write the new mode to `localStorage` alongside the state update.
- No main-process/IPC/DB involvement — this is the only place in the app that would use localStorage, but it's the right tool for a single renderer-only UI preference and avoids adding IPC plumbing for one value.

## 2. Keybinds help screen

**Problem:** Keybinds (arrows, Enter, Escape/Backspace, Space, +/-, V, F, PageUp/Down, Home — see `src/renderer/screen/useKeyboard.ts`) are undiscoverable. No in-app reference.

**Fix:** New row in SETTINGS menu.

- Add `'keybindsHelp'` to the `MenuId` union in `viewStack.ts`, with title `'KEYBINDS'` in the menu-title map.
- Add a `KEYBINDS` row to the settings action list in `useScreen.ts` (alongside ADD FOLDER / RESCAN ALL / etc.), `drillsDown: true`, pushing `{ kind: 'menu', menu: 'keybindsHelp', selected: 0 }`.
- New `case 'keybindsHelp':` in the menu-items builder returning a static list of `ScreenItem`s, one per key/action, built by hand from `useKeyboard.ts`. Each row: `label` = key name (e.g. `"ARROW UP / DOWN"`), `meta` = what it does (e.g. `"MOVE SELECTION"`). Non-interactive: `activate: () => {}`, no `drillsDown`.
- Rows (key — action):
  - ARROW UP / DOWN — MOVE SELECTION
  - PAGE UP / DOWN — JUMP 5
  - ENTER — SELECT / HOLD FOR MENU
  - ESCAPE / BACKSPACE — BACK
  - SPACE — PLAY / PAUSE
  - ARROW LEFT / RIGHT — PREV / NEXT (HOLD TO SEEK)
  - + / - — VOLUME
  - V — CYCLE VISUALIZER
  - F — TOGGLE FAVORITE
  - HOME — GO HOME
  - Any letter/number — SEARCH

No new state, no IPC, no DB changes. Pure static reference view reusing the existing menu/list machinery.

## Testing

- Unit test for `ui.ts`: cycling persists to localStorage; store init reads a previously-set value.
- Manual: cycle visualizer, restart app, confirm mode retained. Navigate SETTINGS > KEYBINDS, confirm list renders and BACK returns to SETTINGS.
