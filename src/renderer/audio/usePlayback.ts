import { useSyncExternalStore } from 'react'
import { audioEngine, type PlaybackState } from './AudioEngine'

/** Playback state, always in sync with the engine. */
export function usePlayback(): PlaybackState {
  return useSyncExternalStore(audioEngine.subscribe, audioEngine.getState, audioEngine.getState)
}

export function formatTime(milliseconds: number): string {
  if (!Number.isFinite(milliseconds) || milliseconds < 0) return '--:--'
  const totalSeconds = Math.floor(milliseconds / 1000)
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
}
