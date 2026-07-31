/**
 * Calcula donde arrancar a reproducir al activar una fila de una playlist.
 *
 * Modulo puro a proposito: no toca IPC ni React, asi que se puede testear
 * entero sin levantar la app.
 */

/** Lo minimo que hace falta de una fila de playlist para esta cuenta. */
export interface PlaylistPlaybackEntry {
  itemId: number
  missing: boolean
}

/**
 * Indice, dentro de la lista YA FILTRADA de reproducibles (sin las
 * `missing`), en el que hay que arrancar `audioEngine.playNow`.
 *
 * Si la fila elegida es reproducible, arranca ahi mismo. Si esta perdida,
 * arranca en la primera reproducible que venga despues en la playlist: no
 * tiene sentido intentar abrir el archivo que falta, pero saltar a la
 * primera pista de la lista (posicion 0) tampoco tiene nada que ver con lo
 * que el usuario señalo. Si no queda ninguna reproducible despues, no hay
 * donde arrancar: devuelve `null`.
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
