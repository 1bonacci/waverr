import { describe, expect, it } from 'vitest'
import { escapeFtsPhrase, escapeLike, planSearch, tokenize } from '../../src/main/library/search'

describe('tokenize', () => {
  it('parte por espacios y descarta los vacios', () => {
    expect(tokenize('  beat   140bpm ')).toEqual(['beat', '140bpm'])
  })

  it('devuelve vacio para una consulta en blanco', () => {
    expect(tokenize('   ')).toEqual([])
  })
})

describe('escapeFtsPhrase', () => {
  it('envuelve el termino como frase literal', () => {
    expect(escapeFtsPhrase('beat')).toBe('"beat"')
  })

  it('neutraliza caracteres que FTS5 leeria como sintaxis', () => {
    // Nombres tipicos de un DAW: guiones, parentesis, asteriscos.
    expect(escapeFtsPhrase('demo-final (v2)*')).toBe('"demo-final (v2)*"')
  })

  it('duplica las comillas internas', () => {
    expect(escapeFtsPhrase('take "3"')).toBe('"take ""3"""')
  })
})

describe('escapeLike', () => {
  it('escapa comodines de LIKE', () => {
    expect(escapeLike('100%_mix')).toBe(String.raw`100\%\_mix`)
  })
})

describe('planSearch', () => {
  it('sin texto lista todo', () => {
    expect(planSearch('')).toEqual({ kind: 'all' })
    expect(planSearch('   ')).toEqual({ kind: 'all' })
  })

  it('usa FTS cuando todos los terminos llegan al minimo de trigram', () => {
    expect(planSearch('beat 140bpm')).toEqual({ kind: 'fts', match: '"beat" AND "140bpm"' })
  })

  it('cae a LIKE si algun termino es demasiado corto para trigram', () => {
    expect(planSearch('v2')).toEqual({ kind: 'like', patterns: ['%v2%'] })
    expect(planSearch('beat v2')).toEqual({ kind: 'like', patterns: ['%beat%', '%v2%'] })
  })
})
