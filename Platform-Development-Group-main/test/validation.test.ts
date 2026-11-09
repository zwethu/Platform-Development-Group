import { describe, expect, it } from 'vitest'
import {
  ValidationError,
  optionalKeywords,
  optionalNullableString,
  parseJsonObject,
  requireNonEmptyString,
} from '../src/lib/validation'

describe('parseJsonObject', () => {
  it('accepts a plain object', () => {
    expect(parseJsonObject({ a: 1 })).toEqual({ a: 1 })
  })

  it('rejects arrays, null, and primitives', () => {
    expect(() => parseJsonObject([1, 2])).toThrow(ValidationError)
    expect(() => parseJsonObject(null)).toThrow(ValidationError)
    expect(() => parseJsonObject('x')).toThrow(ValidationError)
    expect(() => parseJsonObject(42)).toThrow(ValidationError)
  })
})

describe('requireNonEmptyString', () => {
  it('trims and returns a valid string', () => {
    expect(requireNonEmptyString('  hello  ', 'field')).toBe('hello')
  })

  it('rejects empty, whitespace-only, and non-string values', () => {
    expect(() => requireNonEmptyString('', 'field')).toThrow(ValidationError)
    expect(() => requireNonEmptyString('   ', 'field')).toThrow(ValidationError)
    expect(() => requireNonEmptyString(123, 'field')).toThrow(ValidationError)
    expect(() => requireNonEmptyString(undefined, 'field')).toThrow(ValidationError)
    expect(() => requireNonEmptyString(null, 'field')).toThrow(ValidationError)
  })
})

describe('optionalNullableString', () => {
  it('returns null for undefined or null', () => {
    expect(optionalNullableString(undefined, 'field')).toBeNull()
    expect(optionalNullableString(null, 'field')).toBeNull()
  })

  it('trims a provided string', () => {
    expect(optionalNullableString('  x  ', 'field')).toBe('x')
  })

  it('rejects a non-string, non-null value', () => {
    expect(() => optionalNullableString(42, 'field')).toThrow(ValidationError)
    expect(() => optionalNullableString({}, 'field')).toThrow(ValidationError)
  })
})

describe('optionalKeywords', () => {
  it('returns null for undefined, null, or an empty array', () => {
    expect(optionalKeywords(undefined)).toBeNull()
    expect(optionalKeywords(null)).toBeNull()
    expect(optionalKeywords([])).toBeNull()
  })

  it('joins a string array into a single TEXT value', () => {
    expect(optionalKeywords(['rest', ' api ', 'http'])).toBe('rest, api, http')
  })

  it('accepts an already-normalized string as-is (trimmed)', () => {
    expect(optionalKeywords('  rest, api  ')).toBe('rest, api')
  })

  it('drops empty entries from an array', () => {
    expect(optionalKeywords(['rest', '', '  '])).toBe('rest')
  })

  it('rejects an array containing a non-string item', () => {
    expect(() => optionalKeywords(['rest', 42])).toThrow(ValidationError)
  })

  it('rejects a non-string, non-array value', () => {
    expect(() => optionalKeywords(42)).toThrow(ValidationError)
  })
})
