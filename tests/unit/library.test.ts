import { rename, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { Library } from '../../src/main/library/index'
import { createTempLibrary, makeWavBuffer } from './helpers/audio-fixtures'

const openLibraries: Library[] = []
const temporaryRoots: string[] = []

afterEach(async () => {
  for (const library of openLibraries.splice(0)) library.close()
  await Promise.all(temporaryRoots.splice(0).map((path) => rm(path, { recursive: true, force: true })))
})

async function setupLibrary(files: string[]): Promise<{ library: Library; root: string }> {
  const root = await createTempLibrary(files)
  temporaryRoots.push(root)

  const library = Library.open(':memory:')
  openLibraries.push(library)

  await library.addRoot(root)
  await library.scanAll()

  return { library, root }
}

const SAMPLE_FILES = [
  'beats/trap/beat_v3.wav',
  'beats/trap/beat_v7_final.wav',
  'beats/house/loop_128bpm.wav',
  'demos/idea_140bpm.wav',
  'demos/raw voice.wav'
]

describe('roots', () => {
  it('adds a root and counts its tracks', async () => {
    const { library, root } = await setupLibrary(SAMPLE_FILES)

    const roots = library.listRoots()
    expect(roots).toHaveLength(1)
    expect(roots[0]!.path).toBe(root)
    expect(roots[0]!.trackCount).toBe(SAMPLE_FILES.length)
  })

  it('adding the same folder twice does not duplicate it', async () => {
    const { library, root } = await setupLibrary(['a.wav'])

    await library.addRoot(root)
    expect(library.listRoots()).toHaveLength(1)
  })

  it('rejects a path that is not a folder', async () => {
    const library = Library.open(':memory:')
    openLibraries.push(library)

    expect(await library.addRoot('C:/path/that/does/not/exist/waverr')).toBeNull()
    expect(library.listRoots()).toEqual([])
  })
})

describe('hidden tracks', () => {
  it('a hidden track disappears from the lists but keeps its row', async () => {
    const { library } = await setupLibrary(SAMPLE_FILES)
    const target = library.search({ query: 'idea' })[0]!

    library.setTrackHidden(target.id, true)

    expect(library.search({ query: 'idea' })).toHaveLength(0)
    expect(library.search({ sort: 'name' })).toHaveLength(SAMPLE_FILES.length - 1)
    expect(library.getTrack(target.id)?.hidden).toBe(true)
  })

  it('lists what is hidden, and restores it', async () => {
    const { library } = await setupLibrary(SAMPLE_FILES)
    const target = library.search({ query: 'idea' })[0]!

    library.setTrackHidden(target.id, true)
    const hidden = library.search({ onlyHidden: true })
    expect(hidden).toHaveLength(1)
    expect(hidden[0]!.id).toBe(target.id)

    library.setTrackHidden(target.id, false)
    expect(library.search({ onlyHidden: true })).toHaveLength(0)
    expect(library.search({ query: 'idea' })).toHaveLength(1)
  })

  it('stays hidden after a rescan finds the file again', async () => {
    // The reason hiding is a flag and not a DELETE: the file is still sitting
    // under a watched root, so a deleted row would simply be re-inserted as a
    // brand new track on the next scan.
    const { library } = await setupLibrary(SAMPLE_FILES)
    const target = library.search({ query: 'idea' })[0]!

    library.setTrackHidden(target.id, true)
    await library.scanAll()

    expect(library.search({ query: 'idea' })).toHaveLength(0)
    expect(library.search({ onlyHidden: true })).toHaveLength(1)
    // Same row, so favorites and playlist positions survived with it.
    expect(library.search({ onlyHidden: true })[0]!.id).toBe(target.id)
  })

  it('keeps a hidden track out of the totals', async () => {
    const { library } = await setupLibrary(SAMPLE_FILES)
    const target = library.search({ query: 'idea' })[0]!

    expect(library.stats().trackCount).toBe(SAMPLE_FILES.length)
    library.setTrackHidden(target.id, true)

    const stats = library.stats()
    expect(stats.trackCount).toBe(SAMPLE_FILES.length - 1)
    expect(stats.hiddenCount).toBe(1)
  })
})

describe('scanning', () => {
  it('indexes the whole tree and reads duration even with no tags', async () => {
    const { library } = await setupLibrary(SAMPLE_FILES)

    const tracks = library.search({ sort: 'name' })
    expect(tracks).toHaveLength(SAMPLE_FILES.length)

    const track = tracks.find((item) => item.filename === 'beat_v3.wav')!
    expect(track.folder).toBe('trap')
    expect(track.hasTags).toBe(false)
    // The test WAV is 50 ms long: what matters is that duration was read at all.
    expect(track.durationMs).toBeGreaterThan(0)
  })

  it('reports progress for both passes', async () => {
    const root = await createTempLibrary(SAMPLE_FILES)
    temporaryRoots.push(root)

    const library = Library.open(':memory:')
    openLibraries.push(library)
    await library.addRoot(root)

    const phases = new Set<string>()
    await library.scanAll((progress) => phases.add(progress.phase))

    expect(phases.has('walk')).toBe(true)
    expect(phases.has('done')).toBe(true)
  })

  it('a deleted file is marked missing rather than removed', async () => {
    const { library, root } = await setupLibrary(SAMPLE_FILES)

    await rm(join(root, 'demos/idea_140bpm.wav'))
    await library.scanAll()

    expect(library.search({ query: 'idea' })).toHaveLength(0)

    const includingMissing = library.search({ query: 'idea', includeMissing: true })
    expect(includingMissing).toHaveLength(1)
    expect(includingMissing[0]!.missing).toBe(true)
    expect(library.stats().missingCount).toBe(1)
  })

  it('a file that comes back is no longer missing', async () => {
    const { library, root } = await setupLibrary(SAMPLE_FILES)
    const target = join(root, 'demos/idea_140bpm.wav')
    const parked = join(root, 'idea_parked.tmp')

    await rename(target, parked)
    await library.scanAll()
    expect(library.stats().missingCount).toBe(1)

    await rename(parked, target)
    await library.scanAll()
    expect(library.stats().missingCount).toBe(0)
    expect(library.search({ query: 'idea' })).toHaveLength(1)
  })

  it('detects a new file on a rescan', async () => {
    const { library, root } = await setupLibrary(SAMPLE_FILES)

    await writeFile(join(root, 'beats/trap/beat_v8.wav'), makeWavBuffer())
    await library.scanAll()

    expect(library.search({ query: 'beat_v8' })).toHaveLength(1)
    expect(library.stats().trackCount).toBe(SAMPLE_FILES.length + 1)
  })
})

describe('search', () => {
  it('finds a substring in the middle of the name', async () => {
    const { library } = await setupLibrary(SAMPLE_FILES)

    // This is what a word tokenizer could not do: "bpm" does not start a token.
    const hits = library.search({ query: 'bpm' })
    expect(hits.map((track) => track.filename).sort()).toEqual([
      'idea_140bpm.wav',
      'loop_128bpm.wav'
    ])
  })

  it('combines terms with AND', async () => {
    const { library } = await setupLibrary(SAMPLE_FILES)

    expect(library.search({ query: 'beat final' }).map((t) => t.filename)).toEqual([
      'beat_v7_final.wav'
    ])
  })

  it('also searches the path, not just the name', async () => {
    const { library } = await setupLibrary(SAMPLE_FILES)

    const hits = library.search({ query: 'house' })
    expect(hits.map((track) => track.filename)).toEqual(['loop_128bpm.wav'])
  })

  it('handles short queries that trigram cannot index', async () => {
    const { library } = await setupLibrary(SAMPLE_FILES)

    expect(library.search({ query: 'v3' }).map((t) => t.filename)).toEqual(['beat_v3.wav'])
  })

  it('does not break on FTS syntax characters in the query', async () => {
    const { library } = await setupLibrary(SAMPLE_FILES)

    expect(() => library.search({ query: 'beat*(' })).not.toThrow()
    expect(() => library.search({ query: '"quotes"' })).not.toThrow()
  })

  it('prioritizes the filename over the path', async () => {
    const root = await createTempLibrary(['trap/something_else.wav', 'various/trap.wav'])
    temporaryRoots.push(root)

    const library = Library.open(':memory:')
    openLibraries.push(library)
    await library.addRoot(root)
    await library.scanAll()

    const hits = library.search({ query: 'trap' })
    expect(hits[0]!.filename).toBe('trap.wav')
  })

  it('filters by folder', async () => {
    const { library, root } = await setupLibrary(SAMPLE_FILES)

    const hits = library.search({ folderPath: join(root, 'beats/trap'), sort: 'name' })
    expect(hits.map((track) => track.filename)).toEqual(['beat_v3.wav', 'beat_v7_final.wav'])
  })

  it('respects limit and offset', async () => {
    const { library } = await setupLibrary(SAMPLE_FILES)

    const page = library.search({ sort: 'name', limit: 2, offset: 1 })
    expect(page).toHaveLength(2)
    expect(page[0]!.filename).toBe('beat_v7_final.wav')
  })
})

describe('favorites', () => {
  it('toggles on and off', async () => {
    const { library } = await setupLibrary(SAMPLE_FILES)
    const track = library.search({ query: 'beat_v3' })[0]!

    expect(library.toggleFavorite(track.id)).toBe(true)
    expect(library.getTrack(track.id)!.favorite).toBe(true)

    expect(library.toggleFavorite(track.id)).toBe(false)
    expect(library.getTrack(track.id)!.favorite).toBe(false)
  })

  it('the favorites filter returns only the marked ones', async () => {
    const { library } = await setupLibrary(SAMPLE_FILES)
    const tracks = library.search({ sort: 'name' })

    library.toggleFavorite(tracks[0]!.id)
    library.toggleFavorite(tracks[2]!.id)

    const favorites = library.search({ onlyFavorites: true, sort: 'name' })
    expect(favorites.map((track) => track.filename)).toEqual([
      tracks[0]!.filename,
      tracks[2]!.filename
    ])
  })

  it('the mark survives the file going missing and coming back', async () => {
    const { library, root } = await setupLibrary(SAMPLE_FILES)
    const track = library.search({ query: 'idea' })[0]!
    library.toggleFavorite(track.id)

    const target = join(root, 'demos/idea_140bpm.wav')
    const parked = join(root, 'parked.tmp')
    await rename(target, parked)
    await library.scanAll()
    await rename(parked, target)
    await library.scanAll()

    expect(library.search({ onlyFavorites: true })).toHaveLength(1)
  })
})

describe('folder-grouped order', () => {
  it('groups by folder and sorts A-Z inside each group', async () => {
    const { library } = await setupLibrary(SAMPLE_FILES)

    const tracks = library.search({ sort: 'folder' })

    // A single flat list, but tracks from the same folder stay together and in
    // order. This is what makes ALL TRACKS navigable with no folders.
    expect(tracks.map((track) => `${track.folder}/${track.filename}`)).toEqual([
      'demos/idea_140bpm.wav',
      'demos/raw voice.wav',
      'house/loop_128bpm.wav',
      'trap/beat_v3.wav',
      'trap/beat_v7_final.wav'
    ])
  })

  it('does not interleave folders: each one appears in a single block', async () => {
    const { library } = await setupLibrary(SAMPLE_FILES)

    const folders = library.search({ sort: 'folder' }).map((track) => track.folder)
    const blocks = folders.filter((folder, index) => folder !== folders[index - 1])

    expect(blocks).toEqual([...new Set(folders)])
  })
})

describe('path barrier', () => {
  it('accepts files inside a registered root', async () => {
    const { library, root } = await setupLibrary(SAMPLE_FILES)

    expect(library.isPathInsideRoots(join(root, 'beats/trap/beat_v3.wav'))).toBe(true)
    expect(library.isPathInsideRoots(root)).toBe(true)
  })

  it('rejects paths outside the roots', async () => {
    const { library, root } = await setupLibrary(SAMPLE_FILES)

    expect(library.isPathInsideRoots('C:/Windows/System32/config/SAM')).toBe(false)
    expect(library.isPathInsideRoots(join(root, '..', 'neighbor.wav'))).toBe(false)
    expect(library.isPathInsideRoots(join(root, 'beats', '..', '..', 'secret.wav'))).toBe(false)
    expect(library.isPathInsideRoots(`${root}-other/file.wav`)).toBe(false)
  })

  it('accepts nothing with no roots registered', async () => {
    const library = Library.open(':memory:')
    openLibraries.push(library)

    expect(library.isPathInsideRoots('C:/music/beat.wav')).toBe(false)
  })
})
