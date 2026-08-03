import { beforeEach, describe, expect, it } from 'vitest'
import { useUiStore, VISUALIZER_MODE_SETTING_KEY, type UiPersistenceCallbacks } from '../../src/renderer/store/ui'

function fakeCallbacks(initial: string | null = null): UiPersistenceCallbacks & { saved: string[] } {
  let value = initial
  const saved: string[] = []
  return {
    saved,
    getSetting: async (key: string) => (key === VISUALIZER_MODE_SETTING_KEY ? value : null),
    setSetting: async (key: string, v: string) => {
      if (key === VISUALIZER_MODE_SETTING_KEY) value = v
      saved.push(v)
    }
  }
}

beforeEach(() => {
  useUiStore.setState({ visualizerMode: 'bars' })
})

describe('restoreVisualizerMode', () => {
  it('adopts a previously persisted mode', async () => {
    const callbacks = fakeCallbacks('scope')
    await useUiStore.getState().restoreVisualizerMode(callbacks)
    expect(useUiStore.getState().visualizerMode).toBe('scope')
  })

  it('falls back to bars when nothing was persisted', async () => {
    const callbacks = fakeCallbacks(null)
    await useUiStore.getState().restoreVisualizerMode(callbacks)
    expect(useUiStore.getState().visualizerMode).toBe('bars')
  })

  it('ignores a stored value that is not a known mode', async () => {
    useUiStore.setState({ visualizerMode: 'ambient' })
    const callbacks = fakeCallbacks('not-a-real-mode')
    await useUiStore.getState().restoreVisualizerMode(callbacks)
    expect(useUiStore.getState().visualizerMode).toBe('ambient')
  })
})

describe('cycleVisualizer', () => {
  it('cycles through modes in order and wraps', () => {
    const callbacks = fakeCallbacks()
    useUiStore.getState().cycleVisualizer(callbacks)
    expect(useUiStore.getState().visualizerMode).toBe('scope')
    useUiStore.getState().cycleVisualizer(callbacks)
    expect(useUiStore.getState().visualizerMode).toBe('ambient')
    useUiStore.getState().cycleVisualizer(callbacks)
    expect(useUiStore.getState().visualizerMode).toBe('bars')
  })

  it('persists the new mode', () => {
    const callbacks = fakeCallbacks()
    useUiStore.getState().cycleVisualizer(callbacks)
    expect(callbacks.saved).toEqual(['scope'])
  })
})
