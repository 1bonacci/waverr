import { describe, expect, it } from 'vitest'
import {
  startIndexForEntry,
  type PlaylistPlaybackEntry
} from '../../src/renderer/screen/playlistPlayback'

function entries(...missing: boolean[]): PlaylistPlaybackEntry[] {
  return missing.map((isMissing, index) => ({ itemId: index + 1, missing: isMissing }))
}

describe('startIndexForEntry', () => {
  it('pista sana: arranca en su propio lugar dentro de las reproducibles', () => {
    const list = entries(false, false, false)
    expect(startIndexForEntry(list, 2)).toBe(1)
  })

  it('pista perdida con reproducibles despues: arranca en la siguiente que suene', () => {
    // 1 sana, 2 perdida (elegida), 3 perdida, 4 sana
    const list = entries(false, true, true, false)
    // Reproducibles: [1, 4]. La 4 es la siguiente que suena despues de la 2.
    expect(startIndexForEntry(list, 2)).toBe(1)
  })

  it('pista perdida sin nada reproducible despues: no arranca nada', () => {
    const list = entries(false, false, true)
    expect(startIndexForEntry(list, 3)).toBeNull()
  })

  it('playlist entera perdida: no arranca nada sin importar cual se elija', () => {
    const list = entries(true, true, true)
    expect(startIndexForEntry(list, 1)).toBeNull()
    expect(startIndexForEntry(list, 2)).toBeNull()
    expect(startIndexForEntry(list, 3)).toBeNull()
  })

  it('perdidas intercaladas: cada perdida salta a la sana mas cercana despues', () => {
    // 1 sana, 2 perdida, 3 sana, 4 perdida, 5 sana
    const list = entries(false, true, false, true, false)
    // Reproducibles: [1, 3, 5] -> indices 0, 1, 2
    expect(startIndexForEntry(list, 1)).toBe(0)
    expect(startIndexForEntry(list, 2)).toBe(1) // salta a la 3
    expect(startIndexForEntry(list, 3)).toBe(1)
    expect(startIndexForEntry(list, 4)).toBe(2) // salta a la 5
    expect(startIndexForEntry(list, 5)).toBe(2)
  })

  it('itemId que no existe en la lista: no arranca nada', () => {
    const list = entries(false, false)
    expect(startIndexForEntry(list, 999)).toBeNull()
  })
})
