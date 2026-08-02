/**
 * Flattening of the QUEUE view, and index conversion.
 *
 * `audioEngine.getQueueView()` keeps NOW, MANUAL and LATER apart, but the list
 * that gets drawn mixes them into a single column. The row the user sees and
 * touches is not the same index `moveInQueue`/`removeFromQueue` expect (those
 * want an index inside the manual queue only). Rather than rebuilding that
 * conversion by subtracting an offset everywhere it is needed -- easy to get out
 * of step if the section order ever changes -- every row from this module
 * carries its own domain index alongside its position in the list. The caller
 * then never computes an offset by hand: it looks at which row it has and uses
 * the index already inside it.
 *
 * Deliberately a pure module, like `playbackQueue.ts` and `viewStack.ts`: it can
 * be tested in full without `AudioEngine` or the DOM.
 */

import type { Track } from '@shared/types'

/** The minimum of `QueueView` needed to flatten it. */
export interface FlatQueueSource {
  now: Track | null
  manual: Track[]
  upcoming: Track[]
}

export type QueueRow =
  | { section: 'now'; track: Track }
  /** `manualIndex` is the position within `QueueView.manual`: the index that
   *  `moveInQueue` and `removeFromQueue` understand. */
  | { section: 'manual'; track: Track; manualIndex: number }
  /** `upcomingIndex` is the position within `QueueView.upcoming`, used to build
   *  the context when jumping straight to a LATER track. */
  | { section: 'upcoming'; track: Track; upcomingIndex: number }

/** Flattens NOW + MANUAL + LATER in the order they are drawn. */
export function buildQueueRows(view: FlatQueueSource): QueueRow[] {
  const rows: QueueRow[] = []

  if (view.now) rows.push({ section: 'now', track: view.now })
  view.manual.forEach((track, manualIndex) => rows.push({ section: 'manual', track, manualIndex }))
  view.upcoming.forEach((track, upcomingIndex) =>
    rows.push({ section: 'upcoming', track, upcomingIndex })
  )

  return rows
}

/** Only manual queue rows can be reordered: NOW and LATER cannot. */
export function isMovableRow(row: QueueRow): row is Extract<QueueRow, { section: 'manual' }> {
  return row.section === 'manual'
}

/**
 * Translates the row a drag ended on (a position in the full list) into the
 * index inside the manual queue that `moveInQueue` expects.
 *
 * Dropping on the NOW row means the head of the manual queue (index 0);
 * dropping on a LATER row, or past the end of the list, means the tail of the
 * manual queue (`moveInQueue` saturates that index to the last valid one, so
 * there is no need to clamp here).
 */
export function manualIndexForDrop(rows: QueueRow[], rowIndex: number): number {
  const row = rows[rowIndex]
  if (row?.section === 'manual') return row.manualIndex
  if (row?.section === 'now') return 0

  return rows.filter(isMovableRow).length
}

/**
 * Ordinal (0 = first copy) of the row at `manualIndex` among the manual queue
 * entries that share its trackId.
 *
 * Queueing the same track more than once is allowed on purpose (`enqueue` does
 * not deduplicate), so the trackId alone is not enough to identify a row
 * uniquely. This ordinal is computed while the row is on screen (freshly built,
 * with a `manualIndex` that is still trustworthy) so the row can be found again
 * later with `resolveManualIndexById`, even if the list was rebuilt in the
 * meantime.
 */
export function occurrenceInManual(rows: QueueRow[], manualIndex: number): number {
  const manualRows = rows.filter(isMovableRow)
  const target = manualRows[manualIndex]
  if (!target) return 0
  return manualRows.slice(0, manualIndex).filter((row) => row.track.id === target.track.id).length
}

/**
 * Finds, by identity, the index within the manual queue of track `trackId`.
 *
 * Used to resolve the origin of a drag (or of a REMOVE) when the list was
 * rebuilt while a row was being held: if a track ends mid-move, the first
 * element of the manual queue is consumed and every row index shifts. The row
 * index captured when the row was grabbed stops being valid, but the identity
 * of the grabbed track still is.
 *
 * `occurrence` breaks the tie when that track is queued more than once: it is
 * the ordinal computed by `occurrenceInManual` at the moment the row was
 * grabbed. If by now there are fewer copies than that (an earlier one was
 * consumed on its own in the meantime), it falls back to the last remaining
 * copy rather than defaulting to the first.
 *
 * Returns null if that track is no longer in the manual queue (it was consumed
 * on its own while being dragged).
 */
export function resolveManualIndexById(
  rows: QueueRow[],
  trackId: number,
  occurrence: number
): number | null {
  const matches = rows.filter(
    (candidate): candidate is Extract<QueueRow, { section: 'manual' }> =>
      candidate.section === 'manual' && candidate.track.id === trackId
  )
  if (matches.length === 0) return null
  const picked = matches[Math.min(Math.max(occurrence, 0), matches.length - 1)]
  return picked ? picked.manualIndex : null
}
