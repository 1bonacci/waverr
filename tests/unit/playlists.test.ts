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

describe('crear y borrar playlists', () => {
  it('crea una playlist vacia', async () => {
    const library = await setup()
    const playlist = library.createPlaylist('EP verano')

    expect(playlist).not.toBeNull()
    expect(playlist!.name).toBe('EP verano')
    expect(playlist!.trackCount).toBe(0)
    expect(library.listPlaylists()).toHaveLength(1)
  })

  it('rechaza un nombre repetido sin importar mayusculas', async () => {
    const library = await setup()
    library.createPlaylist('EP verano')

    expect(library.createPlaylist('ep VERANO')).toBeNull()
    expect(library.listPlaylists()).toHaveLength(1)
  })

  it('renombra', async () => {
    const library = await setup()
    const playlist = library.createPlaylist('borrador')!

    expect(library.renamePlaylist(playlist.id, 'EP final')).toBe(true)
    expect(library.listPlaylists()[0]!.name).toBe('EP final')
  })

  it('renombrar a un nombre ocupado falla', async () => {
    const library = await setup()
    library.createPlaylist('uno')
    const otra = library.createPlaylist('dos')!

    expect(library.renamePlaylist(otra.id, 'uno')).toBe(false)
    expect(library.listPlaylists().map((item) => item.name).sort()).toEqual(['dos', 'uno'])
  })

  it('borrar la playlist borra sus items', async () => {
    const library = await setup()
    const playlist = library.createPlaylist('temporal')!
    const tracks = library.search({ sort: 'name' })
    library.addToPlaylist(playlist.id, tracks[0]!.id)

    library.deletePlaylist(playlist.id)

    expect(library.listPlaylists()).toEqual([])
    expect(library.listPlaylistTracks(playlist.id)).toEqual([])
  })
})

describe('contenido de una playlist', () => {
  it('agrega en orden y cuenta', async () => {
    const library = await setup()
    const playlist = library.createPlaylist('EP')!
    const tracks = library.search({ sort: 'name' })

    for (const track of tracks) library.addToPlaylist(playlist.id, track.id)

    const entries = library.listPlaylistTracks(playlist.id)
    expect(entries.map((entry) => entry.filename)).toEqual(['a.wav', 'b.wav', 'c.wav'])
    expect(entries.map((entry) => entry.position)).toEqual([0, 1, 2])
    expect(library.listPlaylists()[0]!.trackCount).toBe(3)
  })

  it('permite la misma pista dos veces', async () => {
    const library = await setup()
    const playlist = library.createPlaylist('EP')!
    const track = library.search({ sort: 'name' })[0]!

    library.addToPlaylist(playlist.id, track.id)
    library.addToPlaylist(playlist.id, track.id)

    const entries = library.listPlaylistTracks(playlist.id)
    expect(entries).toHaveLength(2)
    expect(entries[0]!.itemId).not.toBe(entries[1]!.itemId)
  })

  it('quitar deja las posiciones consecutivas', async () => {
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

  it('reordena y deja las posiciones consecutivas', async () => {
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

  it('mover fuera de rango satura en vez de romper', async () => {
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

  it('una pista perdida sigue figurando en la playlist', async () => {
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

  it('crea una playlist a partir de una lista de pistas', async () => {
    const library = await setup()
    const tracks = library.search({ sort: 'name' })

    const playlist = library.createPlaylistFromTracks('sesion', [
      tracks[2]!.id,
      tracks[0]!.id
    ])!

    expect(library.listPlaylistTracks(playlist.id).map((entry) => entry.filename)).toEqual([
      'c.wav',
      'a.wav'
    ])
  })

  it('un trackId inexistente no deja una playlist a medias', async () => {
    const library = await setup()
    const tracks = library.search({ sort: 'name' })
    const idInexistente = tracks.reduce((max, track) => Math.max(max, track.id), 0) + 1000

    expect(() =>
      library.createPlaylistFromTracks('rota', [tracks[0]!.id, idInexistente])
    ).toThrow()

    // Ni la playlist ni sus items sobreviven: todo o nada.
    expect(library.listPlaylists()).toEqual([])
  })
})

describe('settings', () => {
  it('guarda y lee un valor', async () => {
    const library = await setup()
    expect(library.getSetting('queue')).toBeNull()

    library.setSetting('queue', '{"manualTrackIds":[1]}')
    expect(library.getSetting('queue')).toBe('{"manualTrackIds":[1]}')

    library.setSetting('queue', '{"manualTrackIds":[]}')
    expect(library.getSetting('queue')).toBe('{"manualTrackIds":[]}')
  })
})
