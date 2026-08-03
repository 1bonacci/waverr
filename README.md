# waverr

A local audio player with the interface of a classic MP3 player, built for
people who produce their own music.

Ordinary players assume a library with clean ID3 tags. A producer has
`beat_v3.wav`, `demo_final_FINAL.wav` and `idea_140bpm.wav` scattered across
dozens of project folders, almost always with no metadata at all. waverr indexes
those folders, searches by any fragment of the filename or path, and plays
through a device drawn on screen: an LCD, a click wheel and a visualizer.

## Usage

Everything happens inside the device's screen. It can be driven entirely with
the keyboard or entirely with the mouse.

| Key | Action |
|---|---|
| `↑` `↓` | move the selection (or scroll the mouse over the wheel) |
| `↑` `↓` in NOW PLAYING | previous / next track |
| `Enter` | open / play (confirms the text in a prompt) |
| `Enter` held | context menu for the row (or right click with the mouse) |
| `Esc` | back (cancels move mode when a row is held) |
| `Backspace` | delete a letter in search or in a text prompt; back elsewhere |
| `Space` | play / pause (types a space inside a text prompt) |
| `←` `→` | previous / next track |
| `←` `→` in NOW PLAYING | seek 5 s back / forward |
| letters and digits | open search and filter live (type the name inside a prompt) |
| `F` | toggle favorite |
| `V` | change visualizer mode |

The full list is also in the app: `SETTINGS` -> `KEYBINDS`.

To load music: `SETTINGS` -> `+ ADD FOLDER`. You can add more than one root. The
scan runs in two passes: paths first (search works within seconds), then tags
and duration.

**There is no folder browsing.** `ALL TRACKS` is every audio file in one flat
list, sorted by folder and A-Z inside each folder, with the folder name shown on
every row. Files from the same session stay together, but you never have to
enter folder after folder to reach one — and skipping forward walks the whole
library instead of stopping when a folder runs out.

A file that disappears from disk is not removed from the index: it is marked as
missing and keeps its favorites, in case the external drive comes back.

The context menu (hold OK, or right click) offers `PLAY NOW`, `PLAY NEXT`,
`ADD TO QUEUE`, `ADD TO PLAYLIST` and `FAVORITE` on any track; inside `QUEUE` or
a playlist it adds `MOVE` and `REMOVE`. Choosing `MOVE` grabs the row: the
arrows drag it, `Enter` drops it in place and `Esc` cancels the reorder.

`QUEUE` shows what is playing now, what you queued by hand and what follows from
the playback context. Choosing another track to play does not clear what you
queued by hand — it stays until its turn comes. `SAVE AS PLAYLIST`, at the
bottom of that view, turns the whole queue into a new playlist: a listening
session that turned out well becomes something that lasts.

## Development

```bash
npm install
npm run dev        # app with hot reload
npm test           # unit tests (vitest)
npm run test:e2e   # end-to-end smoke test (playwright + electron)
npm run build:win  # NSIS installer in dist/
```

### If `npm run dev` opens and closes instantly

Some environments (the VS Code integrated terminal among them) export
`ELECTRON_RUN_AS_NODE=1`. With that variable set, Electron starts as plain Node:
`require('electron')` does not return `app` and the process dies before opening a
window. Clear it with:

```powershell
Remove-Item Env:\ELECTRON_RUN_AS_NODE
```

## How it is put together

```
src/main/          Node process: owns the disk and the index
  library/         SQLite + FTS5, scanning, tag reading
  media-protocol   serves audio over waverr://track/<id>
src/preload/       the only bridge to the renderer (contextBridge)
src/shared/        types and rules used by both sides
src/renderer/      React: owns the sound and the pixels
  audio/           AudioEngine (outside React, survives re-renders)
  screen/          view stack (pure reducer) and keyboard
  components/      chassis, LCD, wheel, visualizer
```

The renderer never touches `fs`. `contextIsolation` and `sandbox` are on,
`nodeIntegration` is off.

### Two decisions that explain most of it

**Audio is requested by id, not by path.** `waverr://track/42` means the renderer
can only name tracks that are already in the index; there is no way to ask for an
arbitrary file on disk. The main process still revalidates that the file is
inside a registered root folder before opening it.

**The scheme is registered as `standard` and `secure`.** If Chromium treated the
audio as an opaque origin, the `MediaElementSource` would be *tainted* and the
`AnalyserNode` would return zeros: the visualizer would look dead even though the
audio played. The e2e suite checks exactly that by reading the level of the last
frame.

### Search

The FTS5 index uses the `trigram` tokenizer, which finds substrings anywhere:
searching `bpm` matches `loop_140bpm.wav`. A word tokenizer could only match from
the start of each token. Queries of one or two characters, which trigram cannot
index, fall back to `LIKE %x%`.

Measured over 5,000 files: scan ~1 s, slowest search 4 ms.

### Style

Comments, test names and UI strings are in English. There is no linter enforcing
anything about character sets — an earlier "ASCII only, no accents" convention
existed solely because the comments used to be in Spanish, and it no longer
applies.

## Formats

Indexed: `.mp3 .wav .flac .m4a .aac .ogg .opus .aiff .aif .wma`.

Playback verified against real files: MP3, WAV, M4A and OGG. Chromium decodes
FLAC natively but it has not been tried with an actual file yet.

**Chromium does not play AIFF.** Those files are indexed and searchable, but the
decoder that would turn them into an `AudioBuffer` is still missing.
