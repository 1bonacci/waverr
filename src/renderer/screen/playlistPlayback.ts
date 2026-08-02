/**
 * Works out where playback should start when a playlist row is activated.
 *
 * Deliberately a pure module: it touches neither IPC nor React, so it can be
 * tested in full without launching the app.
 */

/** The minimum a playlist row needs to expose for this calculation. */
export interface PlaylistPlaybackEntry {
  itemId: number
  missing: boolean
}

/**
 * Index, within the ALREADY FILTERED list of playable entries (the `missing`
 * ones removed), where `audioEngine.playNow` should start.
 *
 * If the chosen row is playable, playback starts right there. If it is missing,
 * it starts at the first playable entry after it in the playlist: there is no
 * point opening a file that is gone, but jumping to the first track of the list
 * (position 0) has nothing to do with what the user picked either. If no
 * playable entry is left after it, there is nowhere to start: returns `null`.
 */
export function startIndexForEntry(
  entries: ReadonlyArray<PlaylistPlaybackEntry>,
  itemId: number
): number | null {
  const position = entries.findIndex((entry) => entry.itemId === itemId)
  const target = entries[position]
  if (position === -1 || !target) return null

  const playable = entries.filter((entry) => !entry.missing)

  if (!target.missing) {
    const index = playable.findIndex((entry) => entry.itemId === itemId)
    return index === -1 ? null : index
  }

  const next = entries.slice(position + 1).find((entry) => !entry.missing)
  if (!next) return null

  const index = playable.findIndex((entry) => entry.itemId === next.itemId)
  return index === -1 ? null : index
}
