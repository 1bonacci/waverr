/**
 * Translates what the user types into an executable query.
 *
 * Deliberately a pure module: it touches neither SQLite nor Electron, so it can
 * be covered by fast tests.
 */

/** The FTS5 trigram tokenizer cannot index terms shorter than 3 characters. */
export const TRIGRAM_MIN_LENGTH = 3

export type SearchPlan =
  | { kind: 'all' }
  | { kind: 'fts'; match: string }
  | { kind: 'like'; patterns: string[] }

/**
 * Wraps a term as a literal FTS5 phrase. Without this, characters like `-`, `(`
 * or `*` -- which are everywhere in filenames coming out of a DAW -- are read
 * as query syntax and throw.
 */
export function escapeFtsPhrase(term: string): string {
  return `"${term.replace(/"/g, '""')}"`
}

/** Escapes LIKE wildcards. Used together with `ESCAPE '\'`. */
export function escapeLike(term: string): string {
  return term.replace(/[\\%_]/g, (char) => `\\${char}`)
}

export function tokenize(rawQuery: string): string[] {
  return rawQuery.trim().split(/\s+/).filter(Boolean)
}

/**
 * Decides how to search:
 * - no text                   -> list everything
 * - every term >= 3 chars     -> FTS5 trigram (fast, matches substrings)
 * - any short term            -> LIKE %x% (slower but correct; trigram cannot)
 *
 * Terms are combined with AND: typing "beat 140" asks for both.
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
