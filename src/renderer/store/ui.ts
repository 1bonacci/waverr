import { create } from 'zustand'
import { VISUALIZER_MODES, type VisualizerMode } from '../components/visualizerMode'

export const VISUALIZER_MODE_SETTING_KEY = 'visualizerMode'

export interface UiPersistenceCallbacks {
  getSetting(key: string): Promise<string | null>
  setSetting(key: string, value: string): Promise<void>
}

const defaultCallbacks: UiPersistenceCallbacks = {
  getSetting: (key) => window.waverr.library.getSetting(key),
  setSetting: (key, value) => window.waverr.library.setSetting(key, value)
}

interface UiState {
  visualizerMode: VisualizerMode
  cycleVisualizer: (callbacks?: UiPersistenceCallbacks) => void
  /** Loads the persisted visualizer mode. Called once on app start; the
   *  store itself cannot do this at creation time since the settings store
   *  is read asynchronously over IPC. */
  restoreVisualizerMode: (callbacks?: UiPersistenceCallbacks) => Promise<void>
}

/**
 * Device state that belongs to neither the audio engine nor the navigation:
 * for now, which visualizer is active. Persisted through the same
 * settings key/value store the queue uses, so it survives restarts instead
 * of always reopening on "bars".
 */
export const useUiStore = create<UiState>((set, get) => ({
  visualizerMode: 'bars',
  cycleVisualizer: (callbacks = defaultCallbacks) => {
    const index = VISUALIZER_MODES.indexOf(get().visualizerMode)
    const visualizerMode = VISUALIZER_MODES[(index + 1) % VISUALIZER_MODES.length]!
    set({ visualizerMode })
    void callbacks.setSetting(VISUALIZER_MODE_SETTING_KEY, visualizerMode)
  },
  restoreVisualizerMode: async (callbacks = defaultCallbacks) => {
    const stored = await callbacks.getSetting(VISUALIZER_MODE_SETTING_KEY)
    if (VISUALIZER_MODES.includes(stored as VisualizerMode)) {
      set({ visualizerMode: stored as VisualizerMode })
    }
  }
}))
