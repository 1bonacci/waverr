import { rm } from 'node:fs/promises'
import { afterEach, describe, expect, it } from 'vitest'
import { Library } from '../../src/main/library/index'
import { createTempLibrary } from './helpers/audio-fixtures'

const openLibraries: Library[] = []
const temporaryRoots: string[] = []

afterEach(async () => {
  for (const library of openLibraries.splice(0)) library.close()
  await Promise.all(
    temporaryRoots.splice(0).map((path) => rm(path, { recursive: true, force: true }))
  )
})

const FILES = ['a.wav', 'b.wav', 'c.wav']

async function setup(): Promise<Library> {
  const root = await createTempLibrary(FILES)
  temporaryRoots.push(root)
  const library = Library.open(':memory:')
  openLibraries.push(library)
  await library.addRoot(root)
  await library.scanAll()
  return library
}

describe('creating and deleting playlists', () => {
  it('creates an empty playlist', async () => {
    const library = await setup()
    const playlist = library.createPlaylist('Summer EP')

    expect(playlist).not.toBeNull()
    expect(playlist!.name).toBe('Summer EP')
    expect(playlist!.trackCount).toBe(0)
    expect(library.listPlaylists()).toHaveLength(1)
  })

  it('rejects a duplicate name regardless of case', async () => {
    const library = await setup()
    library.createPlaylist('Summer EP')

    expect(library.createPlaylist('summer EP')).toBeNull()
    expect(library.listPlaylists()).toHaveLength(1)
  })

  it('renames', async () => {
    const library = await setup()
    const playlist = library.createPlaylist('draft')!

    expect(library.renamePlaylist(playlist.id, 'Final EP')).toBe(true)
    expect(library.listPlaylists()[0]!.name).toBe('Final EP')
  })

  it('renaming to a name already in use fails', async () => {
    const library = await setup()
    library.createPlaylist('one')
    const other = library.createPlaylist('two')!

    expect(library.renamePlaylist(other.id, 'one')).toBe(false)
    expect(library.listPlaylists().map((item) => item.name).sort()).toEqual(['one', 'two'])
  })

  it('deleting a playlist deletes its items', async () => {
    const library = await setup()
    const playlist = library.createPlaylist('temporary')!
    const tracks = library.search({ sort: 'name' })
    library.addToPlaylist(playlist.id, tracks[0]!.id)

    library.deletePlaylist(playlist.id)

    expect(library.listPlaylists()).toEqual([])
    expect(library.listPlaylistTracks(playlist.id)).toEqual([])
  })
})

describe('playlist contents', () => {
  it('adds in order and counts', async () => {
    const library = await setup()
    const playlist = library.createPlaylist('EP')!
    const tracks = library.search({ sort: 'name' })

    for (const track of tracks) library.addToPlaylist(playlist.id, track.id)

    const entries = library.listPlaylistTracks(playlist.id)
    expect(entries.map((entry) => entry.filename)).toEqual(['a.wav', 'b.wav', 'c.wav'])
    expect(entries.map((entry) => entry.position)).toEqual([0, 1, 2])
    expect(library.listPlaylists()[0]!.trackCount).toBe(3)
  })

  it('allows the same track twice', async () => {
    const library = await setup()
    const playlist = library.createPlaylist('EP')!
    const track = library.search({ sort: 'name' })[0]!

    library.addToPlaylist(playlist.id, track.id)
    library.addToPlaylist(playlist.id, track.id)

    const entries = library.listPlaylistTracks(playlist.id)
    expect(entries).toHaveLength(2)
    expect(entries[0]!.itemId).not.toBe(entries[1]!.itemId)
  })

  it('removing leaves consecutive positions', async () => {
    const library = await setup()
    const playlist = library.createPlaylist('EP')!
    for (const track of library.search({ sort: 'name' })) {
      library.addToPlaylist(playlist.id, track.id)
    }

    const entries = library.listPlaylistTracks(playlist.id)
    library.removeFromPlaylist(entries[1]!.itemId)

    const rest = library.listPlaylistTracks(playlist.id)
    expect(rest.map((entry) => entry.filename)).toEqual(['a.wav', 'c.wav'])
    expect(rest.map((entry) => entry.position)).toEqual([0, 1])
  })

  it('reordering leaves consecutive positions', async () => {
    const library = await setup()
    const playlist = library.createPlaylist('EP')!
    for (const track of library.search({ sort: 'name' })) {
      library.addToPlaylist(playlist.id, track.id)
    }

    library.movePlaylistItem(playlist.id, 2, 0)

    const entries = library.listPlaylistTracks(playlist.id)
    expect(entries.map((entry) => entry.filename)).toEqual(['c.wav', 'a.wav', 'b.wav'])
    expect(entries.map((entry) => entry.position)).toEqual([0, 1, 2])
  })

  it('moving out of range saturates instead of breaking', async () => {
    const library = await setup()
    const playlist = library.createPlaylist('EP')!
    for (const track of library.search({ sort: 'name' })) {
      library.addToPlaylist(playlist.id, track.id)
    }

    library.movePlaylistItem(playlist.id, 0, 99)

    expect(library.listPlaylistTracks(playlist.id).map((entry) => entry.filename)).toEqual([
      'b.wav',
      'c.wav',
      'a.wav'
    ])
  })

  it('a missing track still shows up in the playlist', async () => {
    const library = await setup()
    const playlist = library.createPlaylist('EP')!
    const track = library.search({ sort: 'name' })[0]!
    library.addToPlaylist(playlist.id, track.id)

    await rm(track.path)
    await library.scanAll()

    const entries = library.listPlaylistTracks(playlist.id)
    expect(entries).toHaveLength(1)
    expect(entries[0]!.missing).toBe(true)
  })

  it('creates a playlist from a list of tracks', async () => {
    const library = await setup()
    const tracks = library.search({ sort: 'name' })

    const playlist = library.createPlaylistFromTracks('session', [
      tracks[2]!.id,
      tracks[0]!.id
    ])!

    expect(library.listPlaylistTracks(playlist.id).map((entry) => entry.filename)).toEqual([
      'c.wav',
      'a.wav'
    ])
  })

  it('a nonexistent trackId does not leave a half-built playlist', async () => {
    const library = await setup()
    const tracks = library.search({ sort: 'name' })
    const missingId = tracks.reduce((max, track) => Math.max(max, track.id), 0) + 1000

    expect(() =>
      library.createPlaylistFromTracks('broken', [tracks[0]!.id, missingId])
    ).toThrow()

    // Neither the playlist nor its items survive: all or nothing.
    expect(library.listPlaylists()).toEqual([])
  })
})

describe('settings', () => {
  it('saves and reads a value', async () => {
    const library = await setup()
    expect(library.getSetting('queue')).toBeNull()

    library.setSetting('queue', '{"manualTrackIds":[1]}')
    expect(library.getSetting('queue')).toBe('{"manualTrackIds":[1]}')

    library.setSetting('queue', '{"manualTrackIds":[]}')
    expect(library.getSetting('queue')).toBe('{"manualTrackIds":[]}')
  })
})
