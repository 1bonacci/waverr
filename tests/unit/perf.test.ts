import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { openDatabase } from '../../src/main/library/db'
import { scanRoot } from '../../src/main/library/scanner'
import { makeWavBuffer } from './helpers/audio-fixtures'

/**
 * Target stated in the plan: 5,000 files indexed and search under 50 ms. This
 * test is the safety net that flags it if the index stops meeting that.
 *
 * Only runs the first scan pass (paths, size, date): tag reading is file I/O
 * and is measured separately.
 */
const FILE_COUNT = 5000
const SEARCH_BUDGET_MS = 50

let root: string | null = null

afterAll(async () => {
  if (root) await rm(root, { recursive: true, force: true })
})

async function buildBigLibrary(): Promise<string> {
  const base = await mkdtemp(join(tmpdir(), 'waverr-perf-'))
  const wav = makeWavBuffer(0.01)
  const genres = ['trap', 'house', 'ambient', 'dnb', 'lofi']

  for (const genre of genres) {
    await mkdir(join(base, 'proyectos', genre), { recursive: true })
  }

  const writes: Array<Promise<void>> = []
  for (let index = 0; index < FILE_COUNT; index++) {
    const genre = genres[index % genres.length]!
    const bpm = 80 + (index % 80)
    const name = `${genre}_idea_${index}_${bpm}bpm.wav`
    writes.push(writeFile(join(base, 'proyectos', genre, name), wav))
  }
  await Promise.all(writes)

  return base
}

describe('index performance', () => {
  it(`indexes ${FILE_COUNT} files and searches in under ${SEARCH_BUDGET_MS} ms`, async () => {
    root = await buildBigLibrary()

    const db = openDatabase(':memory:')
    db.prepare('INSERT INTO roots (path, added_at) VALUES (?, ?)').run(root, Date.now())

    const scanStarted = Date.now()
    const result = await scanRoot(db, { id: 1, path: root })
    const scanMs = Date.now() - scanStarted

    expect(result.found).toBe(FILE_COUNT)
    expect(result.added).toBe(FILE_COUNT)

    const queries = ['128bpm', 'trap', 'idea', 'lofi_idea', 'ambient idea', 'dnb']
    const timings: number[] = []

    for (const query of queries) {
      const started = performance.now()
      const rows = db
        .prepare(
          `SELECT t.id FROM tracks_fts
             JOIN tracks t ON t.id = tracks_fts.rowid
            WHERE tracks_fts MATCH ?
            ORDER BY bm25(tracks_fts, 10.0, 2.0, 6.0, 4.0, 4.0) ASC
            LIMIT 200`
        )
        .all(
          query
            .split(' ')
            .map((term) => `"${term}"`)
            .join(' AND ')
        )
      timings.push(performance.now() - started)
      expect(rows.length).toBeGreaterThan(0)
    }

    const slowest = Math.max(...timings)
    console.log(
      `scan of ${FILE_COUNT} files: ${scanMs} ms | slowest search: ${slowest.toFixed(1)} ms`
    )

    db.close()
    expect(slowest).toBeLessThan(SEARCH_BUDGET_MS)
  }, 120000)
})
