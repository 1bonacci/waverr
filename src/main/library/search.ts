/**
 * Traduccion de lo que el usuario tipea a una consulta ejecutable.
 *
 * Modulo puro a proposito: no toca SQLite ni Electron, asi que se puede probar
 * entero con tests rapidos.
 */

/** El tokenizer trigram de FTS5 no puede indexar terminos de menos de 3 caracteres. */
export const TRIGRAM_MIN_LENGTH = 3

export type SearchPlan =
  | { kind: 'all' }
  | { kind: 'fts'; match: string }
  | { kind: 'like'; patterns: string[] }

/**
 * Envuelve un termino como frase literal de FTS5. Sin esto, caracteres como
 * `-`, `(` o `*` que abundan en nombres de archivo de un DAW se interpretan
 * como sintaxis de consulta y tiran error.
 */
export function escapeFtsPhrase(term: string): string {
  return `"${term.replace(/"/g, '""')}"`
}

/** Escapa los comodines de LIKE. Se usa junto con `ESCAPE '\'`. */
export function escapeLike(term: string): string {
  return term.replace(/[\\%_]/g, (char) => `\\${char}`)
}

export function tokenize(rawQuery: string): string[] {
  return rawQuery.trim().split(/\s+/).filter(Boolean)
}

/**
 * Decide como buscar:
 * - sin texto           -> listar todo
 * - todos los terminos >= 3 caracteres -> FTS5 trigram (rapido, subcadenas)
 * - algun termino corto -> LIKE %x% (mas lento pero correcto; trigram no puede)
 *
 * Los terminos se combinan con AND: tipear "beat 140" pide las dos cosas.
 */
export function planSearch(rawQuery: string): SearchPlan {
  const terms = tokenize(rawQuery)
  if (terms.length === 0) return { kind: 'all' }

  const hasShortTerm = terms.some((term) => term.length < TRIGRAM_MIN_LENGTH)
  if (hasShortTerm) {
    return { kind: 'like', patterns: terms.map((term) => `%${escapeLike(term)}%`) }
  }

  return { kind: 'fts', match: terms.map(escapeFtsPhrase).join(' AND ') }
}
