import { create } from 'zustand'
import { VISUALIZER_MODES, type VisualizerMode } from '../components/Visualizer'

interface UiState {
  visualizerMode: VisualizerMode
  cycleVisualizer: () => void
}

/**
 * Estado de la carcasa que no pertenece ni al motor de audio ni a la
 * navegacion: por ahora, cual visual esta activo.
 */
export const useUiStore = create<UiState>((set) => ({
  visualizerMode: 'bars',
  cycleVisualizer: () =>
    set((state) => {
      const index = VISUALIZER_MODES.indexOf(state.visualizerMode)
      return { visualizerMode: VISUALIZER_MODES[(index + 1) % VISUALIZER_MODES.length]! }
    })
}))
