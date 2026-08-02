# Graph Report - .  (2026-08-02)

## Corpus Check
- Corpus is ~46,706 words - fits in a single context window. You may not need a graph.

## Summary
- 494 nodes · 871 edges · 26 communities (21 shown, 5 thin omitted)
- Extraction: 98% EXTRACTED · 2% INFERRED · 0% AMBIGUOUS · INFERRED: 17 edges (avg confidence: 0.78)
- Token cost: 79,863 input · 0 output

## Community Hubs (Navigation)
- React UI Shell
- Screen State and Queue Rows
- Playlists Design Rationale
- Library Scanner and E2E Tests
- Electron Build Tooling
- AudioEngine Transport Methods
- Main Process TS Config
- Preload IPC API Surface
- Playback Queue Model
- Renderer TS Config
- Test TS Config
- Package Dependencies
- Library IPC Handlers
- Main Process Bootstrap
- SQLite Schema and Search
- Canvas Visualizer
- Queue Persistence
- Media Protocol and Range
- FTS5 Search Planning
- Library Roots
- Root TS Project Refs
- Renderer Global Types

## God Nodes (most connected - your core abstractions)
1. `AudioEngine` - 38 edges
2. `Library` - 32 edges
3. `registerLibraryIpc()` - 24 edges
4. `ScreenController` - 15 edges
5. `compilerOptions` - 15 edges
6. `compilerOptions` - 15 edges
7. `compilerOptions` - 15 edges
8. `useScreen()` - 12 edges
9. `Visualizer()` - 11 edges
10. `QueuePersistence` - 10 edges

## Surprising Connections (you probably didn't know these)
- `move clamps at the ends instead of wrapping` --semantically_similar_to--> `ALL TRACKS flat list (no folder browsing)`  [INFERRED] [semantically similar]
  docs/superpowers/specs/2026-07-31-playlists-y-cola-design.md → README.md
- `Manual queue persisted as JSON under settings key 'queue'` --semantically_similar_to--> `Missing tracks marked, never deleted`  [INFERRED] [semantically similar]
  docs/superpowers/specs/2026-07-31-playlists-y-cola-design.md → README.md
- `run()` --indirect_call--> `screenReducer()`  [INFERRED]
  tests/unit/viewStack.test.ts → src/renderer/screen/viewStack.ts
- `playbackQueue pure model (QueueState, advance, playNow)` --conceptually_related_to--> `QUEUE view and SAVE AS PLAYLIST`  [INFERRED]
  docs/superpowers/plans/2026-07-31-playlists-y-cola.md → README.md
- `better-sqlite3 N-API prebuilds, npmRebuild disabled` --shares_data_with--> `FTS5 trigram tokenizer search`  [INFERRED]
  electron-builder.yml → README.md

## Import Cycles
- None detected.

## Hyperedges (group relationships)
- **Playback order pipeline: context, manual queue, shuffle, advance** — docs_superpowers_specs_2026_07_31_playlists_y_cola_design_three_concept_model, docs_superpowers_specs_2026_07_31_playlists_y_cola_design_playback_order_concatenation, docs_superpowers_specs_2026_07_31_playlists_y_cola_design_shuffle_only_context, docs_superpowers_plans_2026_07_31_playlists_y_cola_playbackqueue, docs_superpowers_plans_2026_07_31_playlists_y_cola_buildorder [INFERRED 0.85]
- **Playlist persistence stack: schema, Library CRUD, IPC, preload** — docs_superpowers_specs_2026_07_31_playlists_y_cola_design_migration_v2, docs_superpowers_specs_2026_07_31_playlists_y_cola_design_position_not_in_primary_key, docs_superpowers_plans_2026_07_31_playlists_y_cola_library_playlist_crud, docs_superpowers_plans_2026_07_31_playlists_y_cola_renumber, docs_superpowers_plans_2026_07_31_playlists_y_cola_ipc_channel_registry [INFERRED 0.85]
- **Renderer security boundary: CSP, id-addressed audio, sandboxed renderer** — src_renderer_index_csp_policy, readme_waverr_media_protocol, readme_audio_by_id_not_path, readme_standard_secure_scheme, readme_renderer_sandbox_isolation [INFERRED 0.85]

## Communities (26 total, 5 thin omitted)

### Community 0 - "React UI Shell"
Cohesion: 0.09
Nodes (31): App(), formatTime(), usePlayback(), Chassis(), ChassisProps, Screen(), ScreenProps, statusText() (+23 more)

### Community 1 - "Screen State and Queue Rows"
Cohesion: 0.11
Nodes (34): PlaylistPlaybackEntry, startIndexForEntry(), buildQueueRows(), FlatQueueSource, isMovableRow(), manualIndexForDrop(), occurrenceInManual(), QueueRow (+26 more)

### Community 2 - "Playlists Design Rationale"
Cohesion: 0.05
Nodes (40): MENU cancels move instead of leaving the view, buildOrder shuffle keeps current track first, IPC channels declared in shared types IPC object, Library playlist CRUD and reorder methods, Global constraint: no new dependencies, strict TypeScript, Playlists y cola implementation plan, playbackQueue pure model (QueueState, advance, playNow), renumber keeps playlist positions consecutive (+32 more)

### Community 3 - "Library Scanner and E2E Tests"
Cohesion: 0.10
Nodes (23): AUDIO_EXTENSION_SET, FoundFile, isAudioFile(), KnownTrack, scanRoot(), SKIPPED_DIRECTORIES, walkAudioFiles(), AUDIO_EXTENSIONS (+15 more)

### Community 4 - "Electron Build Tooling"
Cohesion: 0.06
Nodes (31): electron, electron-builder, electron-vite, devDependencies, electron, electron-builder, electron-vite, @playwright/test (+23 more)

### Community 6 - "Main Process TS Config"
Cohesion: 0.07
Nodes (26): electron.vite.config.ts, playwright.config.ts, src/main/**/*.ts, src/preload/**/*.ts, vitest.config.ts, compilerOptions, esModuleInterop, isolatedModules (+18 more)

### Community 8 - "Playback Queue Model"
Cohesion: 0.18
Nodes (21): describeError(), INITIAL_STATE, PlaybackState, PlaybackStatus, advance(), buildOrder(), clamp(), EMPTY_QUEUE (+13 more)

### Community 9 - "Renderer TS Config"
Cohesion: 0.08
Nodes (24): src/renderer/**/*.ts, src/renderer/**/*.tsx, compilerOptions, composite, esModuleInterop, isolatedModules, jsx, lib (+16 more)

### Community 10 - "Test TS Config"
Cohesion: 0.08
Nodes (24): src/**/*.ts, tests/**/*.ts, compilerOptions, esModuleInterop, isolatedModules, jsx, lib, module (+16 more)

### Community 11 - "Package Dependencies"
Cohesion: 0.09
Nodes (22): better-sqlite3, chokidar, music-metadata, author, dependencies, better-sqlite3, chokidar, music-metadata (+14 more)

### Community 12 - "Library IPC Handlers"
Cohesion: 0.18
Nodes (5): registerLibraryIpc(), isUniqueViolation(), Library, LibraryStats, Playlist

### Community 13 - "Main Process Bootstrap"
Cohesion: 0.14
Nodes (12): gotTheLock, registerWindowIpc(), scanInBackground(), throttle(), readPendingMetadata(), TrackTags, registerMediaScheme(), api (+4 more)

### Community 14 - "SQLite Schema and Search"
Cohesion: 0.23
Nodes (10): migrate(), MIGRATIONS, openDatabase(), rowToTrack(), TrackRow, buildOrderBy(), normalizeDir(), PlaylistEntry (+2 more)

### Community 15 - "Canvas Visualizer"
Cohesion: 0.23
Nodes (14): binForBand(), drawAmbient(), drawBars(), drawIdle(), drawScope(), maxDeviation(), maxOf(), readInk() (+6 more)

### Community 16 - "Queue Persistence"
Cohesion: 0.17
Nodes (3): QueuePersistence, QueuePersistenceCallbacks, QueuePersistenceState

### Community 17 - "Media Protocol and Range"
Cohesion: 0.36
Nodes (9): registerMediaProtocol(), toWebStream(), ByteRange, MEDIA_SCHEME, mediaUrlForTrack(), MIME_TYPES, mimeTypeFor(), parseRangeHeader() (+1 more)

### Community 18 - "FTS5 Search Planning"
Cohesion: 0.50
Nodes (6): escapeFtsPhrase(), escapeLike(), planSearch(), SearchPlan, tokenize(), TRIGRAM_MIN_LENGTH

## Knowledge Gaps
- **131 isolated node(s):** `name`, `version`, `private`, `description`, `author` (+126 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **5 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `AudioEngine` connect `AudioEngine Transport Methods` to `React UI Shell`, `Screen State and Queue Rows`, `Playback Queue Model`, `Canvas Visualizer`, `Queue Persistence`?**
  _High betweenness centrality (0.063) - this node is a cross-community bridge._
- **Why does `Track` connect `SQLite Schema and Search` to `Queue Persistence`, `Playback Queue Model`, `Screen State and Queue Rows`, `Preload IPC API Surface`?**
  _High betweenness centrality (0.052) - this node is a cross-community bridge._
- **Why does `QueuePersistence` connect `Queue Persistence` to `Playback Queue Model`, `AudioEngine Transport Methods`?**
  _High betweenness centrality (0.049) - this node is a cross-community bridge._
- **What connects `name`, `version`, `private` to the rest of the system?**
  _131 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `React UI Shell` be split into smaller, more focused modules?**
  _Cohesion score 0.0919661733615222 - nodes in this community are weakly interconnected._
- **Should `Screen State and Queue Rows` be split into smaller, more focused modules?**
  _Cohesion score 0.10520487264673312 - nodes in this community are weakly interconnected._
- **Should `Playlists Design Rationale` be split into smaller, more focused modules?**
  _Cohesion score 0.052564102564102565 - nodes in this community are weakly interconnected._