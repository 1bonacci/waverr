import { rm } from 'node:fs/promises'
import { basename } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { isAudioFile, walkAudioFiles } from '../../src/main/library/scanner'
import { createTempLibrary } from './helpers/audio-fixtures'

const temporaryRoots: string[] = []

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((path) => rm(path, { recursive: true, force: true })))
})

async function makeRoot(files: string[]): Promise<string> {
  const root = await createTempLibrary(files)
  temporaryRoots.push(root)
  return root
}

describe('isAudioFile', () => {
  it('acepta las extensiones de la lista sin importar mayusculas', () => {
    expect(isAudioFile('beat.WAV')).toBe(true)
    expect(isAudioFile('idea.flac')).toBe(true)
    expect(isAudioFile('take.aiff')).toBe(true)
  })

  it('rechaza lo que no es audio', () => {
    expect(isAudioFile('proyecto.als')).toBe(false)
    expect(isAudioFile('tapa.jpg')).toBe(false)
    expect(isAudioFile('sin-extension')).toBe(false)
  })
})

describe('walkAudioFiles', () => {
  it('encuentra audio en subcarpetas y descarta el resto', async () => {
    const root = await makeRoot([
      'beats/beat_v3.wav',
      'beats/render/beat_v3_master.wav',
      'demos/idea_140bpm.wav',
      'demos/proyecto.als',
      'tapa.jpg'
    ])

    const found = []
    for await (const file of walkAudioFiles(root)) found.push(file)

    expect(found.map((file) => file.filename).sort()).toEqual([
      'beat_v3.wav',
      'beat_v3_master.wav',
      'idea_140bpm.wav'
    ])
  })

  it('completa dir y folder de cada archivo', async () => {
    const root = await makeRoot(['beats/trap/beat_v3.wav'])

    const found = []
    for await (const file of walkAudioFiles(root)) found.push(file)

    expect(found).toHaveLength(1)
    const file = found[0]!
    expect(file.folder).toBe('trap')
    expect(basename(file.dir)).toBe('trap')
    expect(file.ext).toBe('.wav')
    expect(file.size).toBeGreaterThan(44)
  })

  it('saltea carpetas ocultas y basura del sistema', async () => {
    const root = await makeRoot([
      'ok.wav',
      '.cache/oculto.wav',
      'node_modules/paquete/ruido.wav'
    ])

    const found = []
    for await (const file of walkAudioFiles(root)) found.push(file)

    expect(found.map((file) => file.filename)).toEqual(['ok.wav'])
  })

  it('no explota con una raiz inexistente', async () => {
    const found = []
    for await (const file of walkAudioFiles('C:/ruta/que/no/existe/waverr')) found.push(file)
    expect(found).toEqual([])
  })
})
