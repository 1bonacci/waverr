/**
 * Aplanado de la vista COLA y conversion de indices.
 *
 * `audioEngine.getQueueView()` separa AHORA, MANUAL y LUEGO, pero la lista que
 * se dibuja los mezcla en una sola columna. La fila que el usuario ve y toca
 * no es el mismo indice que espera `moveInQueue`/`removeFromQueue` (esos
 * esperan un indice dentro de la cola manual nada mas). En vez de reconstruir
 * esa conversion con una resta de offset en cada lugar que la necesita (facil
 * de desalinear si cambia el orden de las secciones), cada fila de este
 * modulo lleva su propio indice de dominio ademas de su posicion en la lista.
 * Asi el llamador nunca calcula un offset a mano: solo mira de que fila se
 * trata y usa el indice que ya viene adentro.
 *
 * Modulo puro a proposito, igual que `playbackQueue.ts` y `viewStack.ts`: se
 * puede probar entero sin `AudioEngine` ni el DOM.
 */

import type { Track } from '@shared/types'

/** Lo minimo que hace falta de `QueueView` para aplanarla. */
export interface FlatQueueSource {
  now: Track | null
  manual: Track[]
  upcoming: Track[]
}

export type QueueRow =
  | { section: 'now'; track: Track }
  /** `manualIndex` es la posicion dentro de `QueueView.manual`: el indice que
   *  entienden `moveInQueue` y `removeFromQueue`. */
  | { section: 'manual'; track: Track; manualIndex: number }
  /** `upcomingIndex` es la posicion dentro de `QueueView.upcoming`, para armar
   *  el contexto al saltar directo a una pista de LUEGO. */
  | { section: 'upcoming'; track: Track; upcomingIndex: number }

/** Aplana AHORA + MANUAL + LUEGO en el orden en que se dibujan. */
export function buildQueueRows(view: FlatQueueSource): QueueRow[] {
  const rows: QueueRow[] = []

  if (view.now) rows.push({ section: 'now', track: view.now })
  view.manual.forEach((track, manualIndex) => rows.push({ section: 'manual', track, manualIndex }))
  view.upcoming.forEach((track, upcomingIndex) =>
    rows.push({ section: 'upcoming', track, upcomingIndex })
  )

  return rows
}

/** Solo las filas de la cola manual se pueden reordenar: AHORA y LUEGO no. */
export function isMovableRow(row: QueueRow): row is Extract<QueueRow, { section: 'manual' }> {
  return row.section === 'manual'
}

/**
 * Traduce la fila donde termino un arrastre (posicion en la lista completa)
 * al indice dentro de la cola manual que espera `moveInQueue`.
 *
 * Soltar sobre la fila AHORA equivale a la punta de la cola manual (indice
 * 0); soltar sobre una fila de LUEGO, o mas alla del final de la lista,
 * equivale a la cola de la cola manual (`moveInQueue` satura ese indice al
 * ultimo valido, asi que no hace falta clampear aca).
 */
export function manualIndexForDrop(rows: QueueRow[], rowIndex: number): number {
  const row = rows[rowIndex]
  if (row?.section === 'manual') return row.manualIndex
  if (row?.section === 'now') return 0

  return rows.filter(isMovableRow).length
}
