import { create } from 'zustand'
import { VISUALIZER_MODES, type VisualizerMode } from '../components/Visualizer'

interface UiState {
  visualizerMode: VisualizerMode
  cycleVisualizer: () => void
}

/**
 * Device state that belongs to neither the audio engine nor the navigation:
 * for now, which visualizer is active.
 */
export const useUiStore = create<UiState>((set) => ({
  visualizerMode: 'bars',
  cycleVisualizer: () =>
    set((state) => {
      const index = VISUALIZER_MODES.indexOf(state.visualizerMode)
      return { visualizerMode: VISUALIZER_MODES[(index + 1) % VISUALIZER_MODES.length]! }
    })
}))
