import { useSyncExternalStore } from 'react'
import { audioEngine, type PlaybackState } from './AudioEngine'

/** Playback state, always in sync with the engine. */
export function usePlayback(): PlaybackState {
  return useSyncExternalStore(audioEngine.subscribe, audioEngine.getState, audioEngine.getState)
}

/**
 * Just the id of the track currently loaded, for callers that only need to
 * know "is this row the one playing" (a list marking its playing row, say).
 * `usePlayback()` returns a new object on every `timeupdate` -- several
 * times a second while something plays -- so a component that only cares
 * about the track id must not subscribe through it, or it re-renders on
 * every position tick instead of only when the track actually changes.
 */
export function usePlayingTrackId(): number | null {
  return useSyncExternalStore(
    audioEngine.subscribe,
    () => audioEngine.getState().track?.id ?? null,
    () => audioEngine.getState().track?.id ?? null
  )
}

export function formatTime(milliseconds: number): string {
  if (!Number.isFinite(milliseconds) || milliseconds < 0) return '--:--'
  const totalSeconds = Math.floor(milliseconds / 1000)
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
}
