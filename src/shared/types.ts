/**
 * Tipos compartidos entre el proceso main, el preload y el renderer.
 * Este archivo es la unica fuente de verdad del contrato de IPC.
 */

/** Canales de IPC. Centralizados para que main y preload no se desincronicen. */
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

  /** main -> renderer, progreso de escaneo */
  libraryScanProgress: 'library:scanProgress'
} as const

/** Extensiones que waverr considera audio. */
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
  /** Nombre del archivo con extension. */
  filename: string
  /** Ruta completa de la carpeta contenedora. */
  dir: string
  /** Nombre de esa carpeta: hace de "album" cuando no hay tags. */
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

/** Una pista dentro de una playlist. `itemId` la identifica como fila de la
 *  playlist, porque la misma pista puede estar dos veces. */
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
  /** Archivos procesados en la fase actual. */
  done: number
  /** Total conocido de la fase actual. 0 mientras se camina el arbol. */
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
  /** Texto libre. Vacio devuelve todo ordenado por `sort`. */
  query?: string
  /** Limitar a una carpeta exacta. */
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

/** API que el preload expone en `window.waverr`. */
export interface WaverrApi {
  window: {
    minimize(): void
    close(): void
  }
  library: {
    listRoots(): Promise<Root[]>
    /** Abre el dialogo del sistema. Devuelve la raiz agregada o null si se cancelo. */
    pickRoot(): Promise<Root | null>
    addRoot(path: string): Promise<Root | null>
    removeRoot(rootId: number): Promise<void>
    rescan(): Promise<ScanResult[]>
    search(query: TrackQuery): Promise<Track[]>
    listTracks(query: TrackQuery): Promise<Track[]>
    getTrack(trackId: number): Promise<Track | null>
    stats(): Promise<LibraryStats>
    /** Devuelve el estado resultante: true si quedo marcada como favorita. */
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
