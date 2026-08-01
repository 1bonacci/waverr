import { parseFile } from 'music-metadata'
import type { Database as SqliteDatabase } from 'better-sqlite3'
import type { ScanProgress } from '../../shared/types'

/** How many files are read in parallel. More than this saturates the disk
 *  without gaining any time. */
const CONCURRENCY = 6

/** Rows written per transaction. */
const BATCH_SIZE = 200

export interface TrackTags {
  title: string | null
  artist: string | null
  album: string | null
  durationMs: number | null
}

/**
 * Reads a file's tags. Never throws: a corrupt file, or one in an unusual
 * format, comes back with empty tags and stays playable under its filename.
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
 * Second pass of the pipeline: fills in tags and duration for everything the
 * first pass left pending.
 *
 * It can be cut off halfway without leaving the index inconsistent: each file
 * sets `metadata_read = 1` when it finishes, so the next run picks up where
 * this one stopped.
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
