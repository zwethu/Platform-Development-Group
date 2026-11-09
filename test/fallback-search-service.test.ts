import { describe, expect, it } from 'vitest'
import { findFallbackMatches, tokenizeQuestion } from '../src/services/fallback-search-service'
import type { KnowledgeSource } from '../src/lib/types'

function makeSource(overrides: Partial<KnowledgeSource>): KnowledgeSource {
  return {
    id: crypto.randomUUID(),
    courseId: 'SE101',
    title: 'Untitled',
    sourceType: 'document',
    sourceUrl: null,
    storageKey: null,
    content: null,
    keywords: null,
    status: 'approved',
    fileName: null,
    segmentCount: null,
    createdBy: 'instructor-1',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  }
}

describe('tokenizeQuestion', () => {
  it('lowercases, splits on punctuation, and de-duplicates terms', () => {
    expect(tokenizeQuestion('REST? API! rest, Webhooks')).toEqual(['rest', 'api', 'webhooks'])
  })

  it('drops common words, so "the" alone never counts as a match', () => {
    expect(tokenizeQuestion('What is REST? What is an API!')).toEqual(['rest', 'api'])
    expect(tokenizeQuestion('When is the midterm exam?')).toEqual(['midterm', 'exam'])
  })

  it('drops single-character noise terms', () => {
    expect(tokenizeQuestion('a b rest')).toEqual(['rest'])
  })
})

describe('findFallbackMatches', () => {
  it('returns no matches when nothing overlaps the approved sources', () => {
    const sources = [makeSource({ title: 'Database Normalization', content: 'Talks about SQL joins.' })]

    expect(findFallbackMatches(sources, 'What is REST?')).toEqual([])
  })

  it('ranks a title match above a content-only match', () => {
    const titleMatch = makeSource({ id: 'title-match', title: 'Week 3 REST API Slides', content: null })
    const contentOnlyMatch = makeSource({
      id: 'content-match',
      title: 'Unrelated Topic',
      content: 'This lecture briefly mentions rest as a concept.',
    })

    const matches = findFallbackMatches([contentOnlyMatch, titleMatch], 'What is REST?')

    expect(matches.length).toBe(2)
    expect(matches[0].source.id).toBe('title-match')
    expect(matches[0].score).toBeGreaterThan(matches[1].score)
  })

  it('produces a non-empty excerpt even when content is null', () => {
    const source = makeSource({ title: 'REST Basics', content: null, keywords: 'rest, http' })
    const [match] = findFallbackMatches([source], 'What is REST?')

    expect(match.excerpt.length).toBeGreaterThan(0)
  })

  it('caps results at 3 citations', () => {
    const sources = Array.from({ length: 5 }, (_, i) => makeSource({ id: `s${i}`, title: `REST guide ${i}` }))

    expect(findFallbackMatches(sources, 'REST').length).toBe(3)
  })
})
