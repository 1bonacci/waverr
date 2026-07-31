import { opendir, stat } from 'node:fs/promises'
import { basename, dirname, extname, join, sep } from 'node:path'
import type { Database as SqliteDatabase } from 'better-sqlite3'
import { AUDIO_EXTENSIONS, type ScanProgress, type ScanResult } from '../../shared/types'

const AUDIO_EXTENSION_SET = new Set<string>(AUDIO_EXTENSIONS)

/**
 * Carpetas que nunca contienen musica del usuario y si pueden contener decenas
 * de miles de archivos. Saltearlas es la diferencia entre segundos y minutos.
 */
const SKIPPED_DIRECTORIES = new Set([
  '$recycle.bin',
  'system volume information',
  'node_modules',
  '.git',
  '.svn'
])

/** Profundidad maxima. Corta bucles de symlinks y arboles patologicos. */
const MAX_DEPTH = 24

/** Cuantas filas se escriben por transaccion durante el escaneo. */
const BATCH_SIZE = 500

export interface FoundFile {
  path: string
  filename: string
  dir: string
  folder: string
  ext: string
  size: number
  mtime: number
}

export function isAudioFile(filename: string): boolean {
  return AUDIO_EXTENSION_SET.has(extname(filename).toLowerCase())
}

/**
 * Recorre un arbol de carpetas y emite los archivos de audio que encuentra.
 *
 * Los errores de permisos no abortan el escaneo: una carpeta ilegible se
 * saltea y el resto de la biblioteca se indexa igual.
 */
export async function* walkAudioFiles(rootPath: string): AsyncGenerator<FoundFile> {
  const pending: Array<{ path: string; depth: number }> = [{ path: rootPath, depth: 0 }]

  while (pending.length > 0) {
    const current = pending.pop()
    if (!current) break
    if (current.depth > MAX_DEPTH) continue

    let dir
    try {
      dir = await opendir(current.path)
    } catch {
      continue // carpeta ilegible o borrada mientras escaneabamos
    }

    try {
      for await (const entry of dir) {
        const entryPath = join(current.path, entry.name)

        if (entry.isDirectory()) {
          const name = entry.name.toLowerCase()
          if (name.startsWith('.') || SKIPPED_DIRECTORIES.has(name)) continue
          pending.push({ path: entryPath, depth: current.depth + 1 })
          continue
        }

        if (!entry.isFile() || !isAudioFile(entry.name)) continue

        try {
          const info = await stat(entryPath)
          const dir = dirname(entryPath)
          yield {
            path: entryPath,
            filename: entry.name,
            dir,
            folder: basename(dir) || dir,
            ext: extname(entry.name).toLowerCase(),
            size: info.size,
            mtime: Math.floor(info.mtimeMs)
          }
        } catch {
          continue // el archivo desaparecio entre el readdir y el stat
        }
      }
    } catch {
      continue
    }
  }
}

interface KnownTrack {
  id: number
  size: number
  mtime: number
  missing: number
}

/**
 * Escanea una raiz completa y sincroniza el indice.
 *
 * Primera pasada del pipeline: solo rutas, tamanio y fecha. Rapida a proposito,
 * porque apenas termina esto la busqueda ya funciona. Los tags los lee despues
 * `readPendingMetadata`.
 */
export async function scanRoot(
  db: SqliteDatabase,
  root: { id: number; path: string },
  onProgress?: (progress: ScanProgress) => void
): Promise<ScanResult> {
  const startedAt = Date.now()

  const known = new Map<string, KnownTrack>()
  const knownRows = db
    .prepare('SELECT id, path, size, mtime, missing FROM tracks WHERE root_id = ?')
    .all(root.id) as Array<{ id: number; path: string; size: number; mtime: number; missing: number }>
  for (const row of knownRows) {
    known.set(row.path, { id: row.id, size: row.size, mtime: row.mtime, missing: row.missing })
  }

  const insert = db.prepare(`
    INSERT INTO tracks (root_id, path, filename, dir, folder, ext, size, mtime, added_at, missing, metadata_read)
    VALUES (@rootId, @path, @filename, @dir, @folder, @ext, @size, @mtime, @addedAt, 0, 0)
  `)
  const update = db.prepare(`
    UPDATE tracks
       SET size = @size, mtime = @mtime, filename = @filename, dir = @dir, folder = @folder,
           missing = 0, metadata_read = 0
     WHERE id = @id
  `)
  const clearMissing = db.prepare('UPDATE tracks SET missing = 0 WHERE id = ?')
  const markMissing = db.prepare('UPDATE tracks SET missing = 1 WHERE id = ?')

  const seen = new Set<string>()
  let found = 0
  let added = 0
  let updated = 0

  let batch: Array<() => void> = []
  const flush = db.transaction((operations: Array<() => void>) => {
    for (const operation of operations) operation()
  })

  const now = Date.now()

  for await (const file of walkAudioFiles(root.path)) {
    found++
    seen.add(file.path)
    const existing = known.get(file.path)

    if (!existing) {
      added++
      batch.push(() =>
        insert.run({
          rootId: root.id,
          path: file.path,
          filename: file.filename,
          dir: file.dir,
          folder: file.folder,
          ext: file.ext,
          size: file.size,
          mtime: file.mtime,
          addedAt: now
        })
      )
    } else if (existing.size !== file.size || existing.mtime !== file.mtime) {
      updated++
      batch.push(() =>
        update.run({
          id: existing.id,
          size: file.size,
          mtime: file.mtime,
          filename: file.filename,
          dir: file.dir,
          folder: file.folder
        })
      )
    } else if (existing.missing === 1) {
      // Estaba marcado como perdido y volvio a aparecer (disco externo).
      batch.push(() => clearMissing.run(existing.id))
    }

    if (batch.length >= BATCH_SIZE) {
      flush(batch)
      batch = []
      onProgress?.({ phase: 'walk', done: found, total: 0, rootPath: root.path })
    }
  }

  if (batch.length > 0) flush(batch)

  // Lo que ya no esta en disco se marca perdido, no se borra: asi conserva
  // favoritos, notas y posicion en playlists por si el disco vuelve a montarse.
  let missing = 0
  const nowMissing: number[] = []
  for (const [path, entry] of known) {
    if (seen.has(path) || entry.missing === 1) continue
    nowMissing.push(entry.id)
    missing++
  }
  if (nowMissing.length > 0) {
    db.transaction((ids: number[]) => {
      for (const id of ids) markMissing.run(id)
    })(nowMissing)
  }

  onProgress?.({ phase: 'walk', done: found, total: found, rootPath: root.path })

  return { found, added, updated, missing, durationMs: Date.now() - startedAt }
}

/** Normaliza una ruta de carpeta para comparar sin sorpresas de separador final. */
export function normalizeFolderPath(path: string): string {
  return path.endsWith(sep) && path.length > 1 ? path.slice(0, -1) : path
}
