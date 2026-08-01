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

/**
 * Ordinal (0 = primera copia) de la fila en `manualIndex` entre las entradas
 * de la cola manual que comparten su trackId.
 *
 * Encolar la misma pista mas de una vez esta permitido a proposito (`enqueue`
 * no deduplica), asi que el trackId solo no alcanza para identificar una fila
 * de forma unica. Este ordinal se calcula en el momento en que la fila esta a
 * la vista (recien armada, con un `manualIndex` todavia confiable) para poder
 * volver a encontrarla despues con `resolveManualIndexById`, aunque la lista
 * se haya reconstruido mientras tanto.
 */
export function occurrenceInManual(rows: QueueRow[], manualIndex: number): number {
  const manualRows = rows.filter(isMovableRow)
  const target = manualRows[manualIndex]
  if (!target) return 0
  return manualRows.slice(0, manualIndex).filter((row) => row.track.id === target.track.id).length
}

/**
 * Encuentra, por identidad, el indice dentro de la cola manual de la pista
 * `trackId`.
 *
 * Se usa para resolver el origen de un arrastre (o de un QUITAR) cuando la
 * lista se reconstruyo mientras se sostenia una fila: si una pista termina
 * durante el movimiento, se consume el primer elemento de la cola manual y
 * todos los indices de fila corren. El indice de fila que se guardo al
 * agarrar la fila deja de servir, pero la identidad de la pista agarrada
 * sigue siendo valida.
 *
 * `occurrence` desempata cuando esa pista esta encolada mas de una vez: es el
 * ordinal calculado con `occurrenceInManual` en el momento en que se agarro
 * la fila. Si para entonces ya no quedan tantas copias (alguna anterior se
 * consumio sola mientras tanto), se cae a la ultima copia que quede en vez de
 * resolver a la primera por default.
 *
 * Devuelve null si esa pista ya no esta en la cola manual (se consumio sola
 * mientras se arrastraba).
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
