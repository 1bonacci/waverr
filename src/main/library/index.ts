import { stat } from 'node:fs/promises'
import { resolve, sep } from 'node:path'
import type { Database as SqliteDatabase } from 'better-sqlite3'
import type {
  FolderEntry,
  LibraryStats,
  Playlist,
  PlaylistEntry,
  Root,
  ScanProgress,
  ScanResult,
  Track,
  TrackQuery
} from '../../shared/types'
import { openDatabase, rowToTrack, type TrackRow } from './db'
import { readPendingMetadata } from './metadata'
import { scanRoot } from './scanner'
import { planSearch } from './search'

const DEFAULT_LIMIT = 200

/** Columnas que devuelven una fila lista para `rowToTrack`. */
const TRACK_COLUMNS = `t.*, COALESCE(m.favorite, 0) AS favorite`

/**
 * Fachada de la biblioteca. Es el unico objeto que el resto del proceso main
 * usa para hablar con el indice: nadie mas ejecuta SQL.
 */
export class Library {
  private constructor(private readonly db: SqliteDatabase) {}

  static open(filePath: string): Library {
    return new Library(openDatabase(filePath))
  }

  close(): void {
    this.db.close()
  }

  // --- Raices ------------------------------------------------------------

  listRoots(): Root[] {
    const rows = this.db
      .prepare(
        `SELECT r.id, r.path, r.added_at,
                (SELECT COUNT(*) FROM tracks t WHERE t.root_id = r.id AND t.missing = 0) AS track_count
           FROM roots r
          ORDER BY r.added_at ASC`
      )
      .all() as Array<{ id: number; path: string; added_at: number; track_count: number }>

    return rows.map((row) => ({
      id: row.id,
      path: row.path,
      addedAt: row.added_at,
      trackCount: row.track_count
    }))
  }

  /**
   * Registra una carpeta raiz. Idempotente: agregar dos veces la misma ruta
   * devuelve la existente en lugar de duplicarla.
   */
  async addRoot(rawPath: string): Promise<Root | null> {
    const path = resolve(rawPath)

    const info = await stat(path).catch(() => null)
    if (!info?.isDirectory()) return null

    const existing = this.db.prepare('SELECT id FROM roots WHERE path = ?').get(path) as
      | { id: number }
      | undefined

    if (!existing) {
      this.db
        .prepare('INSERT INTO roots (path, added_at) VALUES (?, ?)')
        .run(path, Date.now())
    }

    return this.listRoots().find((root) => root.path === path) ?? null
  }

  removeRoot(rootId: number): void {
    this.db.prepare('DELETE FROM roots WHERE id = ?').run(rootId)
  }

  // --- Escaneo -----------------------------------------------------------

  /**
   * Escanea todas las raices y despues completa los tags pendientes.
   *
   * El orden importa: la primera pasada de todas las raices termina antes de
   * empezar a leer tags, para que la busqueda quede utilizable cuanto antes.
   */
  async scanAll(onProgress?: (progress: ScanProgress) => void): Promise<ScanResult[]> {
    const results: ScanResult[] = []

    for (const root of this.listRoots()) {
      results.push(await scanRoot(this.db, root, onProgress))
    }

    await readPendingMetadata(this.db, onProgress)
    return results
  }

  // --- Consultas ---------------------------------------------------------

  getTrack(trackId: number): Track | null {
    const row = this.db
      .prepare(
        `SELECT ${TRACK_COLUMNS} FROM tracks t
         LEFT JOIN marks m ON m.track_id = t.id
         WHERE t.id = ?`
      )
      .get(trackId) as TrackRow | undefined

    return row ? rowToTrack(row) : null
  }

  /** Carpetas con al menos una pista presente, para el navegador de la pantalla. */
  listFolders(): FolderEntry[] {
    const rows = this.db
      .prepare(
        `SELECT dir, folder, COUNT(*) AS track_count
           FROM tracks
          WHERE missing = 0
          GROUP BY dir
          ORDER BY folder COLLATE NOCASE ASC`
      )
      .all() as Array<{ dir: string; folder: string; track_count: number }>

    return rows.map((row) => ({
      path: row.dir,
      name: row.folder,
      trackCount: row.track_count
    }))
  }

  /**
   * Busqueda unificada. Es la misma funcion que alimenta la lista de carpetas,
   * la de favoritos y el filtro incremental de la pantalla: solo cambian los
   * campos de `TrackQuery`.
   */
  search(query: TrackQuery): Track[] {
    const limit = query.limit ?? DEFAULT_LIMIT
    const offset = query.offset ?? 0
    const plan = planSearch(query.query ?? '')

    const conditions: string[] = []
    const params: unknown[] = []

    if (plan.kind === 'fts') {
      conditions.push('tracks_fts MATCH ?')
      params.push(plan.match)
    } else if (plan.kind === 'like') {
      for (const pattern of plan.patterns) {
        conditions.push(String.raw`(t.filename LIKE ? ESCAPE '\' OR t.path LIKE ? ESCAPE '\')`)
        params.push(pattern, pattern)
      }
    }

    if (!query.includeMissing) conditions.push('t.missing = 0')
    if (query.onlyFavorites) conditions.push('COALESCE(m.favorite, 0) = 1')
    if (query.folderPath) {
      conditions.push('t.dir = ?')
      params.push(normalizeDir(query.folderPath))
    }

    const from =
      plan.kind === 'fts'
        ? `FROM tracks_fts
           JOIN tracks t ON t.id = tracks_fts.rowid
           LEFT JOIN marks m ON m.track_id = t.id`
        : `FROM tracks t
           LEFT JOIN marks m ON m.track_id = t.id`

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''
    const orderBy = buildOrderBy(query.sort, plan.kind === 'fts')

    const rows = this.db
      .prepare(`SELECT ${TRACK_COLUMNS} ${from} ${where} ${orderBy} LIMIT ? OFFSET ?`)
      .all(...params, limit, offset) as TrackRow[]

    return rows.map(rowToTrack)
  }

  /**
   * Marca o desmarca un favorito y devuelve el estado resultante.
   *
   * Las marcas viven en su propia tabla: sobreviven a que el archivo se pierda
   * y vuelva, porque estan atadas a la fila de la pista y no al archivo.
   */
  toggleFavorite(trackId: number): boolean {
    const current = this.db
      .prepare('SELECT favorite FROM marks WHERE track_id = ?')
      .get(trackId) as { favorite: number } | undefined

    const next = current?.favorite === 1 ? 0 : 1

    this.db
      .prepare(
        `INSERT INTO marks (track_id, favorite) VALUES (?, ?)
         ON CONFLICT(track_id) DO UPDATE SET favorite = excluded.favorite`
      )
      .run(trackId, next)

    return next === 1
  }

  stats(): LibraryStats {
    const row = this.db
      .prepare(
        `SELECT
           (SELECT COUNT(*) FROM tracks WHERE missing = 0)              AS track_count,
           (SELECT COUNT(*) FROM tracks WHERE missing = 1)              AS missing_count,
           (SELECT COUNT(*) FROM roots)                                 AS root_count,
           (SELECT COALESCE(SUM(duration_ms), 0) FROM tracks WHERE missing = 0) AS total_duration_ms`
      )
      .get() as {
      track_count: number
      missing_count: number
      root_count: number
      total_duration_ms: number
    }

    return {
      trackCount: row.track_count,
      missingCount: row.missing_count,
      rootCount: row.root_count,
      totalDurationMs: row.total_duration_ms
    }
  }

  // --- Playlists ---------------------------------------------------------

  listPlaylists(): Playlist[] {
    const rows = this.db
      .prepare(
        `SELECT p.id, p.name, p.created_at, p.updated_at,
                (SELECT COUNT(*) FROM playlist_items i WHERE i.playlist_id = p.id) AS track_count
           FROM playlists p
          ORDER BY p.name COLLATE NOCASE ASC`
      )
      .all() as Array<{
      id: number
      name: string
      created_at: number
      updated_at: number
      track_count: number
    }>

    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      trackCount: row.track_count,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    }))
  }

  /** Devuelve null si el nombre ya esta ocupado (la comparacion ignora mayusculas). */
  createPlaylist(name: string): Playlist | null {
    const clean = name.trim()
    if (clean.length === 0) return null

    const now = Date.now()
    try {
      const result = this.db
        .prepare('INSERT INTO playlists (name, created_at, updated_at) VALUES (?, ?, ?)')
        .run(clean, now, now)
      return this.listPlaylists().find((item) => item.id === Number(result.lastInsertRowid)) ?? null
    } catch {
      return null
    }
  }

  renamePlaylist(playlistId: number, name: string): boolean {
    const clean = name.trim()
    if (clean.length === 0) return false

    try {
      const result = this.db
        .prepare('UPDATE playlists SET name = ?, updated_at = ? WHERE id = ?')
        .run(clean, Date.now(), playlistId)
      return result.changes > 0
    } catch {
      return false
    }
  }

  deletePlaylist(playlistId: number): void {
    this.db.prepare('DELETE FROM playlists WHERE id = ?').run(playlistId)
  }

  addToPlaylist(playlistId: number, trackId: number): void {
    const next = this.db
      .prepare('SELECT COALESCE(MAX(position) + 1, 0) AS next FROM playlist_items WHERE playlist_id = ?')
      .get(playlistId) as { next: number }

    this.db
      .prepare('INSERT INTO playlist_items (playlist_id, track_id, position) VALUES (?, ?, ?)')
      .run(playlistId, trackId, next.next)
    this.touchPlaylist(playlistId)
  }

  removeFromPlaylist(itemId: number): void {
    const row = this.db
      .prepare('SELECT playlist_id FROM playlist_items WHERE id = ?')
      .get(itemId) as { playlist_id: number } | undefined
    if (!row) return

    this.db.prepare('DELETE FROM playlist_items WHERE id = ?').run(itemId)
    this.renumber(row.playlist_id)
    this.touchPlaylist(row.playlist_id)
  }

  /** Incluye las pistas perdidas: el disco externo puede volver a aparecer. */
  listPlaylistTracks(playlistId: number): PlaylistEntry[] {
    const rows = this.db
      .prepare(
        `SELECT ${TRACK_COLUMNS}, i.id AS item_id, i.position AS item_position
           FROM playlist_items i
           JOIN tracks t ON t.id = i.track_id
           LEFT JOIN marks m ON m.track_id = t.id
          WHERE i.playlist_id = ?
          ORDER BY i.position ASC`
      )
      .all(playlistId) as Array<TrackRow & { item_id: number; item_position: number }>

    return rows.map((row) => ({
      ...rowToTrack(row),
      itemId: row.item_id,
      position: row.item_position
    }))
  }

  /** Satura en los extremos, igual que el modelo de la cola. */
  movePlaylistItem(playlistId: number, from: number, to: number): void {
    const ids = this.db
      .prepare('SELECT id FROM playlist_items WHERE playlist_id = ? ORDER BY position ASC')
      .all(playlistId) as Array<{ id: number }>

    if (from < 0 || from >= ids.length) return
    const target = Math.max(0, Math.min(to, ids.length - 1))
    if (target === from) return

    const [moved] = ids.splice(from, 1)
    if (!moved) return
    ids.splice(target, 0, moved)

    const update = this.db.prepare('UPDATE playlist_items SET position = ? WHERE id = ?')
    this.db.transaction((ordered: Array<{ id: number }>) => {
      ordered.forEach((item, index) => update.run(index, item.id))
    })(ids)

    this.touchPlaylist(playlistId)
  }

  createPlaylistFromTracks(name: string, trackIds: number[]): Playlist | null {
    const playlist = this.createPlaylist(name)
    if (!playlist) return null

    for (const trackId of trackIds) this.addToPlaylist(playlist.id, trackId)
    return this.listPlaylists().find((item) => item.id === playlist.id) ?? null
  }

  // --- Ajustes -----------------------------------------------------------

  getSetting(key: string): string | null {
    const row = this.db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as
      | { value: string }
      | undefined
    return row?.value ?? null
  }

  setSetting(key: string, value: string): void {
    this.db
      .prepare(
        `INSERT INTO settings (key, value) VALUES (?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value`
      )
      .run(key, value)
  }

  private renumber(playlistId: number): void {
    const ids = this.db
      .prepare('SELECT id FROM playlist_items WHERE playlist_id = ? ORDER BY position ASC')
      .all(playlistId) as Array<{ id: number }>

    const update = this.db.prepare('UPDATE playlist_items SET position = ? WHERE id = ?')
    this.db.transaction(() => {
      ids.forEach((item, index) => update.run(index, item.id))
    })()
  }

  private touchPlaylist(playlistId: number): void {
    this.db.prepare('UPDATE playlists SET updated_at = ? WHERE id = ?').run(Date.now(), playlistId)
  }

  /**
   * Comprueba que una ruta pertenezca a alguna raiz registrada.
   *
   * Es la barrera de seguridad del protocolo de medios: el renderer pide rutas
   * y sin esto podria pedir cualquier archivo del disco.
   */
  isPathInsideRoots(rawPath: string): boolean {
    const target = resolve(rawPath).toLowerCase()

    return this.listRoots().some((root) => {
      const rootPath = resolve(root.path).toLowerCase()
      if (target === rootPath) return true
      const prefix = rootPath.endsWith(sep) ? rootPath : rootPath + sep
      return target.startsWith(prefix)
    })
  }
}

function normalizeDir(path: string): string {
  const resolved = resolve(path)
  return resolved.length > 1 && resolved.endsWith(sep) ? resolved.slice(0, -1) : resolved
}

function buildOrderBy(sort: TrackQuery['sort'], hasRelevance: boolean): string {
  switch (sort) {
    case 'recent':
      return 'ORDER BY t.added_at DESC, t.filename COLLATE NOCASE ASC'
    case 'name':
      return 'ORDER BY t.filename COLLATE NOCASE ASC'
    default:
      // bm25 devuelve valores negativos: mas chico es mejor. Los pesos hacen
      // que un match en el nombre de archivo gane a uno en la ruta.
      return hasRelevance
        ? 'ORDER BY bm25(tracks_fts, 10.0, 2.0, 6.0, 4.0, 4.0) ASC'
        : 'ORDER BY t.filename COLLATE NOCASE ASC'
  }
}
