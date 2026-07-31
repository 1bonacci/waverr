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
  libraryListFolders: 'library:listFolders',
  libraryListTracks: 'library:listTracks',
  libraryGetTrack: 'library:getTrack',
  libraryStats: 'library:stats',
  libraryToggleFavorite: 'library:toggleFavorite',

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

export interface FolderEntry {
  /** Ruta absoluta de la carpeta. */
  path: string
  /** Nombre para mostrar en la pantalla. */
  name: string
  trackCount: number
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
  sort?: 'relevance' | 'recent' | 'name'
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
    listFolders(): Promise<FolderEntry[]>
    listTracks(query: TrackQuery): Promise<Track[]>
    getTrack(trackId: number): Promise<Track | null>
    stats(): Promise<LibraryStats>
    /** Devuelve el estado resultante: true si quedo marcada como favorita. */
    toggleFavorite(trackId: number): Promise<boolean>
    onScanProgress(listener: (progress: ScanProgress) => void): () => void
  }
}
