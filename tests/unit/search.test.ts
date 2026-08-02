import { describe, expect, it } from 'vitest'
import { escapeFtsPhrase, escapeLike, planSearch, tokenize } from '../../src/main/library/search'

describe('tokenize', () => {
  it('splits on whitespace and drops empties', () => {
    expect(tokenize('  beat   140bpm ')).toEqual(['beat', '140bpm'])
  })

  it('returns empty for a blank query', () => {
    expect(tokenize('   ')).toEqual([])
  })
})

describe('escapeFtsPhrase', () => {
  it('wraps the term as a literal phrase', () => {
    expect(escapeFtsPhrase('beat')).toBe('"beat"')
  })

  it('neutralizes characters FTS5 would read as syntax', () => {
    // Typical DAW filenames: hyphens, parentheses, asterisks.
    expect(escapeFtsPhrase('demo-final (v2)*')).toBe('"demo-final (v2)*"')
  })

  it('doubles internal quotes', () => {
    expect(escapeFtsPhrase('take "3"')).toBe('"take ""3"""')
  })
})

describe('escapeLike', () => {
  it('escapes LIKE wildcards', () => {
    expect(escapeLike('100%_mix')).toBe(String.raw`100\%\_mix`)
  })
})

describe('planSearch', () => {
  it('lists everything with no text', () => {
    expect(planSearch('')).toEqual({ kind: 'all' })
    expect(planSearch('   ')).toEqual({ kind: 'all' })
  })

  it('uses FTS when every term reaches the trigram minimum', () => {
    expect(planSearch('beat 140bpm')).toEqual({ kind: 'fts', match: '"beat" AND "140bpm"' })
  })

  it('falls back to LIKE when a term is too short for trigram', () => {
    expect(planSearch('v2')).toEqual({ kind: 'like', patterns: ['%v2%'] })
    expect(planSearch('beat v2')).toEqual({ kind: 'like', patterns: ['%beat%', '%v2%'] })
  })
})
