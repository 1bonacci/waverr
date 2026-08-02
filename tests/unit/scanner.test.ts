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
  it('accepts the listed extensions regardless of case', () => {
    expect(isAudioFile('beat.WAV')).toBe(true)
    expect(isAudioFile('idea.flac')).toBe(true)
    expect(isAudioFile('take.aiff')).toBe(true)
  })

  it('rejects anything that is not audio', () => {
    expect(isAudioFile('project.als')).toBe(false)
    expect(isAudioFile('cover.jpg')).toBe(false)
    expect(isAudioFile('no-extension')).toBe(false)
  })
})

describe('walkAudioFiles', () => {
  it('finds audio in subfolders and drops the rest', async () => {
    const root = await makeRoot([
      'beats/beat_v3.wav',
      'beats/render/beat_v3_master.wav',
      'demos/idea_140bpm.wav',
      'demos/project.als',
      'cover.jpg'
    ])

    const found = []
    for await (const file of walkAudioFiles(root)) found.push(file)

    expect(found.map((file) => file.filename).sort()).toEqual([
      'beat_v3.wav',
      'beat_v3_master.wav',
      'idea_140bpm.wav'
    ])
  })

  it('fills in dir and folder for every file', async () => {
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

  it('skips hidden folders and system clutter', async () => {
    const root = await makeRoot([
      'ok.wav',
      '.cache/hidden.wav',
      'node_modules/package/noise.wav'
    ])

    const found = []
    for await (const file of walkAudioFiles(root)) found.push(file)

    expect(found.map((file) => file.filename)).toEqual(['ok.wav'])
  })

  it('does not blow up on a nonexistent root', async () => {
    const found = []
    for await (const file of walkAudioFiles('C:/path/that/does/not/exist/waverr')) found.push(file)
    expect(found).toEqual([])
  })
})
