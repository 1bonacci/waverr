import { parseFile } from 'music-metadata'
import type { Database as SqliteDatabase } from 'better-sqlite3'
import type { ScanProgress } from '../../shared/types'

/** Cuantos archivos se leen en paralelo. Mas que esto satura el disco sin ganar tiempo. */
const CONCURRENCY = 6

/** Filas que se escriben por transaccion. */
const BATCH_SIZE = 200

export interface TrackTags {
  title: string | null
  artist: string | null
  album: string | null
  durationMs: number | null
}

/**
 * Lee tags de un archivo. Nunca lanza: un archivo corrupto o de formato raro
 * devuelve tags vacios y sigue siendo reproducible desde su nombre.
 */
export async function readTags(filePath: string): Promise<TrackTags> {
  try {
    const parsed = await parseFile(filePath, { duration: true })
    const duration = parsed.format.duration
    return {
      title: parsed.common.title?.trim() || null,
      artist: parsed.common.artist?.trim() || null,
      album: parsed.common.album?.trim() || null,
      durationMs: typeof duration === 'number' ? Math.round(duration * 1000) : null
    }
  } catch {
    return { title: null, artist: null, album: null, durationMs: null }
  }
}

/**
 * Segunda pasada del pipeline: completa tags y duracion de todo lo que la
 * primera pasada dejo pendiente.
 *
 * Se puede cortar a la mitad sin dejar el indice inconsistente: cada archivo
 * marca `metadata_read = 1` al terminar, asi que la proxima corrida retoma.
 */
export async function readPendingMetadata(
  db: SqliteDatabase,
  onProgress?: (progress: ScanProgress) => void
): Promise<number> {
  const pending = db
    .prepare('SELECT id, path FROM tracks WHERE metadata_read = 0 AND missing = 0')
    .all() as Array<{ id: number; path: string }>

  if (pending.length === 0) {
    onProgress?.({ phase: 'done', done: 0, total: 0, rootPath: '' })
    return 0
  }

  const update = db.prepare(`
    UPDATE tracks
       SET title = @title, artist = @artist, album = @album,
           duration_ms = @durationMs, has_tags = @hasTags, metadata_read = 1
     WHERE id = @id
  `)

  interface PendingWrite extends TrackTags {
    id: number
    hasTags: number
  }

  const flush = db.transaction((writes: PendingWrite[]) => {
    for (const write of writes) update.run(write)
  })

  let done = 0
  let cursor = 0
  let batch: PendingWrite[] = []

  async function worker(): Promise<void> {
    while (cursor < pending.length) {
      const item = pending[cursor++]
      if (!item) break

      const tags = await readTags(item.path)
      batch.push({
        id: item.id,
        ...tags,
        hasTags: tags.title || tags.artist || tags.album ? 1 : 0
      })
      done++

      if (batch.length >= BATCH_SIZE) {
        flush(batch)
        batch = []
        onProgress?.({ phase: 'metadata', done, total: pending.length, rootPath: '' })
      }
    }
  }

  await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()))

  if (batch.length > 0) flush(batch)
  onProgress?.({ phase: 'done', done, total: pending.length, rootPath: '' })

  return done
}
