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
  'demos/voz cruda.wav'
]

describe('raices', () => {
  it('agrega una raiz y cuenta sus pistas', async () => {
    const { library, root } = await setupLibrary(SAMPLE_FILES)

    const roots = library.listRoots()
    expect(roots).toHaveLength(1)
    expect(roots[0]!.path).toBe(root)
    expect(roots[0]!.trackCount).toBe(SAMPLE_FILES.length)
  })

  it('agregar dos veces la misma carpeta no la duplica', async () => {
    const { library, root } = await setupLibrary(['a.wav'])

    await library.addRoot(root)
    expect(library.listRoots()).toHaveLength(1)
  })

  it('rechaza una ruta que no es carpeta', async () => {
    const library = Library.open(':memory:')
    openLibraries.push(library)

    expect(await library.addRoot('C:/ruta/inexistente/waverr')).toBeNull()
    expect(library.listRoots()).toEqual([])
  })
})

describe('escaneo', () => {
  it('indexa todo el arbol y lee duracion aunque no haya tags', async () => {
    const { library } = await setupLibrary(SAMPLE_FILES)

    const tracks = library.search({ sort: 'name' })
    expect(tracks).toHaveLength(SAMPLE_FILES.length)

    const track = tracks.find((item) => item.filename === 'beat_v3.wav')!
    expect(track.folder).toBe('trap')
    expect(track.hasTags).toBe(false)
    // El WAV de prueba dura 50 ms: lo importante es que la duracion se leyo.
    expect(track.durationMs).toBeGreaterThan(0)
  })

  it('reporta progreso de las dos pasadas', async () => {
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

  it('un archivo borrado queda marcado como perdido, no se borra', async () => {
    const { library, root } = await setupLibrary(SAMPLE_FILES)

    await rm(join(root, 'demos/idea_140bpm.wav'))
    await library.scanAll()

    expect(library.search({ query: 'idea' })).toHaveLength(0)

    const includingMissing = library.search({ query: 'idea', includeMissing: true })
    expect(includingMissing).toHaveLength(1)
    expect(includingMissing[0]!.missing).toBe(true)
    expect(library.stats().missingCount).toBe(1)
  })

  it('un archivo que vuelve deja de estar perdido', async () => {
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

  it('detecta un archivo nuevo en un rescaneo', async () => {
    const { library, root } = await setupLibrary(SAMPLE_FILES)

    await writeFile(join(root, 'beats/trap/beat_v8.wav'), makeWavBuffer())
    await library.scanAll()

    expect(library.search({ query: 'beat_v8' })).toHaveLength(1)
    expect(library.stats().trackCount).toBe(SAMPLE_FILES.length + 1)
  })
})

describe('busqueda', () => {
  it('encuentra por subcadena en el medio del nombre', async () => {
    const { library } = await setupLibrary(SAMPLE_FILES)

    // Esto es lo que un tokenizer de palabras no podria: "bpm" no arranca token.
    const hits = library.search({ query: 'bpm' })
    expect(hits.map((track) => track.filename).sort()).toEqual([
      'idea_140bpm.wav',
      'loop_128bpm.wav'
    ])
  })

  it('combina terminos con AND', async () => {
    const { library } = await setupLibrary(SAMPLE_FILES)

    expect(library.search({ query: 'beat final' }).map((t) => t.filename)).toEqual([
      'beat_v7_final.wav'
    ])
  })

  it('busca tambien por la ruta, no solo por el nombre', async () => {
    const { library } = await setupLibrary(SAMPLE_FILES)

    const hits = library.search({ query: 'house' })
    expect(hits.map((track) => track.filename)).toEqual(['loop_128bpm.wav'])
  })

  it('maneja consultas cortas que trigram no puede indexar', async () => {
    const { library } = await setupLibrary(SAMPLE_FILES)

    expect(library.search({ query: 'v3' }).map((t) => t.filename)).toEqual(['beat_v3.wav'])
  })

  it('no rompe con caracteres de sintaxis FTS en la consulta', async () => {
    const { library } = await setupLibrary(SAMPLE_FILES)

    expect(() => library.search({ query: 'beat*(' })).not.toThrow()
    expect(() => library.search({ query: '"comillas"' })).not.toThrow()
  })

  it('prioriza el nombre de archivo sobre la ruta', async () => {
    const root = await createTempLibrary(['trap/otra_cosa.wav', 'varios/trap.wav'])
    temporaryRoots.push(root)

    const library = Library.open(':memory:')
    openLibraries.push(library)
    await library.addRoot(root)
    await library.scanAll()

    const hits = library.search({ query: 'trap' })
    expect(hits[0]!.filename).toBe('trap.wav')
  })

  it('filtra por carpeta', async () => {
    const { library, root } = await setupLibrary(SAMPLE_FILES)

    const hits = library.search({ folderPath: join(root, 'beats/trap'), sort: 'name' })
    expect(hits.map((track) => track.filename)).toEqual(['beat_v3.wav', 'beat_v7_final.wav'])
  })

  it('respeta limit y offset', async () => {
    const { library } = await setupLibrary(SAMPLE_FILES)

    const page = library.search({ sort: 'name', limit: 2, offset: 1 })
    expect(page).toHaveLength(2)
    expect(page[0]!.filename).toBe('beat_v7_final.wav')
  })
})

describe('favoritos', () => {
  it('marca y desmarca', async () => {
    const { library } = await setupLibrary(SAMPLE_FILES)
    const track = library.search({ query: 'beat_v3' })[0]!

    expect(library.toggleFavorite(track.id)).toBe(true)
    expect(library.getTrack(track.id)!.favorite).toBe(true)

    expect(library.toggleFavorite(track.id)).toBe(false)
    expect(library.getTrack(track.id)!.favorite).toBe(false)
  })

  it('el filtro de favoritos devuelve solo los marcados', async () => {
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

  it('la marca sobrevive a que el archivo se pierda y vuelva', async () => {
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

describe('carpetas', () => {
  it('lista carpetas distintas con su conteo', async () => {
    const { library } = await setupLibrary(SAMPLE_FILES)

    const folders = library.listFolders()
    expect(folders.map((folder) => `${folder.name}:${folder.trackCount}`).sort()).toEqual([
      'demos:2',
      'house:1',
      'trap:2'
    ])
  })
})

describe('barrera de rutas', () => {
  it('acepta archivos dentro de una raiz registrada', async () => {
    const { library, root } = await setupLibrary(SAMPLE_FILES)

    expect(library.isPathInsideRoots(join(root, 'beats/trap/beat_v3.wav'))).toBe(true)
    expect(library.isPathInsideRoots(root)).toBe(true)
  })

  it('rechaza rutas fuera de las raices', async () => {
    const { library, root } = await setupLibrary(SAMPLE_FILES)

    expect(library.isPathInsideRoots('C:/Windows/System32/config/SAM')).toBe(false)
    expect(library.isPathInsideRoots(join(root, '..', 'vecino.wav'))).toBe(false)
    expect(library.isPathInsideRoots(join(root, 'beats', '..', '..', 'secreto.wav'))).toBe(false)
    expect(library.isPathInsideRoots(`${root}-otro/archivo.wav`)).toBe(false)
  })

  it('sin raices registradas no acepta nada', async () => {
    const library = Library.open(':memory:')
    openLibraries.push(library)

    expect(library.isPathInsideRoots('C:/musica/beat.wav')).toBe(false)
  })
})
