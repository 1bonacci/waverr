/**
 * Types shared between the main process, the preload and the renderer.
 * This file is the single source of truth for the IPC contract.
 */

/** IPC channels. Centralized so main and preload cannot drift apart. */
export const IPC = {
  windowMinimize: 'window:minimize',
  windowClose: 'window:close',

  libraryListRoots: 'library:listRoots',
  libraryAddRoot: 'library:addRoot',
  libraryPickRoot: 'library:pickRoot',
  libraryRemoveRoot: 'library:removeRoot',
  libraryRescan: 'library:rescan',
  librarySearch: 'library:search',
  libraryListTracks: 'library:listTracks',
  libraryGetTrack: 'library:getTrack',
  libraryStats: 'library:stats',
  libraryToggleFavorite: 'library:toggleFavorite',

  libraryListPlaylists: 'library:listPlaylists',
  libraryCreatePlaylist: 'library:createPlaylist',
  libraryRenamePlaylist: 'library:renamePlaylist',
  libraryDeletePlaylist: 'library:deletePlaylist',
  libraryAddToPlaylist: 'library:addToPlaylist',
  libraryRemoveFromPlaylist: 'library:removeFromPlaylist',
  libraryListPlaylistTracks: 'library:listPlaylistTracks',
  libraryMovePlaylistItem: 'library:movePlaylistItem',
  libraryCreatePlaylistFromTracks: 'library:createPlaylistFromTracks',
  libraryGetSetting: 'library:getSetting',
  librarySetSetting: 'library:setSetting',

  /** main -> renderer, scan progress */
  libraryScanProgress: 'library:scanProgress'
} as const

/** Extensions waverr treats as audio. */
export const AUDIO_EXTENSIONS = [
  '.mp3',
  '.wav',
  '.flac',
  '.m4a',
  '.aac',
  '.ogg',
  '.opus',
  '.aiff',
  '.aif',
  '.wma'
] as const

export interface Root {
  id: number
  path: string
  addedAt: number
  trackCount: number
}

export interface Track {
  id: number
  rootId: number
  path: string
  /** Filename including the extension. */
  filename: string
  /** Full path of the containing folder. */
  dir: string
  /** Name of that folder: stands in for the album when there are no tags. */
  folder: string
  ext: string
  size: number
  mtime: number
  durationMs: number | null
  title: string | null
  artist: string | null
  album: string | null
  hasTags: boolean
  addedAt: number
  lastPlayedAt: number | null
  playCount: number
  missing: boolean
  favorite: boolean
}

export interface Playlist {
  id: number
  name: string
  trackCount: number
  createdAt: number
  updatedAt: number
}

/** A track inside a playlist. `itemId` identifies it as a row of that
 *  playlist, because the same track can appear twice. */
export interface PlaylistEntry extends Track {
  itemId: number
  position: number
}

export interface LibraryStats {
  trackCount: number
  missingCount: number
  rootCount: number
  totalDurationMs: number
}

export type ScanPhase = 'walk' | 'metadata' | 'done'

export interface ScanProgress {
  phase: ScanPhase
  /** Files processed in the current phase. */
  done: number
  /** Known total for the current phase. 0 while the tree is being walked. */
  total: number
  rootPath: string
}

export interface ScanResult {
  found: number
  added: number
  updated: number
  missing: number
  durationMs: number
}

export interface TrackQuery {
  /** Free text. Empty returns everything, ordered by `sort`. */
  query?: string
  /** Restrict to one exact folder. */
  folderPath?: string
  onlyFavorites?: boolean
  includeMissing?: boolean
  /**
   * `folder` groups tracks by their containing folder and sorts A-Z inside
   * each group. It is what the flat ALL TRACKS list uses: one scrollable list,
   * but files from the same session stay together.
   */
  sort?: 'relevance' | 'recent' | 'name' | 'folder'
  limit?: number
  offset?: number
}

/** The API the preload exposes on `window.waverr`. */
export interface WaverrApi {
  window: {
    minimize(): void
    close(): void
  }
  library: {
    listRoots(): Promise<Root[]>
    /** Opens the system dialog. Returns the added root, or null if cancelled. */
    pickRoot(): Promise<Root | null>
    addRoot(path: string): Promise<Root | null>
    removeRoot(rootId: number): Promise<void>
    rescan(): Promise<ScanResult[]>
    search(query: TrackQuery): Promise<Track[]>
    listTracks(query: TrackQuery): Promise<Track[]>
    getTrack(trackId: number): Promise<Track | null>
    stats(): Promise<LibraryStats>
    /** Returns the resulting state: true if it ended up marked as a favorite. */
    toggleFavorite(trackId: number): Promise<boolean>
    listPlaylists(): Promise<Playlist[]>
    createPlaylist(name: string): Promise<Playlist | null>
    renamePlaylist(playlistId: number, name: string): Promise<boolean>
    deletePlaylist(playlistId: number): Promise<void>
    addToPlaylist(playlistId: number, trackId: number): Promise<void>
    removeFromPlaylist(itemId: number): Promise<void>
    listPlaylistTracks(playlistId: number): Promise<PlaylistEntry[]>
    movePlaylistItem(playlistId: number, from: number, to: number): Promise<void>
    createPlaylistFromTracks(name: string, trackIds: number[]): Promise<Playlist | null>
    getSetting(key: string): Promise<string | null>
    setSetting(key: string, value: string): Promise<void>
    onScanProgress(listener: (progress: ScanProgress) => void): () => void
  }
}
