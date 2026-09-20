// Deterministic, keyword-only fallback search over approved knowledge
// sources. No LLM, no vector search — matches question terms against a
// source's title, keywords, and content, and is intentionally simple:
// a source either contains matching terms or it doesn't.

import type { KnowledgeSource } from '../lib/types'

export interface FallbackMatch {
  source: KnowledgeSource
  excerpt: string
  score: number
}

const TITLE_WEIGHT = 3
const KEYWORD_WEIGHT = 2
const CONTENT_WEIGHT = 1
const MAX_CITATIONS = 3
const MIN_TERM_LENGTH = 2
const EXCERPT_CONTEXT_CHARS = 60
const EXCERPT_FALLBACK_LENGTH = 160

export function tokenizeQuestion(text: string): string[] {
  const terms = text
    .toLowerCase()
    .split(/[^a-z0-9]+/i)
    .map((term) => term.trim())
    .filter((term) => term.length >= MIN_TERM_LENGTH)

  return Array.from(new Set(terms))
}

/** Always returns a non-empty, bounded-length excerpt, even without content. */
function buildExcerpt(source: KnowledgeSource, terms: string[]): string {
  const content = source.content?.trim()

  if (content) {
    const lower = content.toLowerCase()
    const matchedTerm = terms.find((term) => lower.includes(term))

    if (matchedTerm) {
      const index = lower.indexOf(matchedTerm)
      const start = Math.max(0, index - EXCERPT_CONTEXT_CHARS)
      const end = Math.min(content.length, index + matchedTerm.length + EXCERPT_CONTEXT_CHARS)
      const prefix = start > 0 ? '…' : ''
      const suffix = end < content.length ? '…' : ''
      return `${prefix}${content.slice(start, end).trim()}${suffix}`
    }

    const truncated = content.length > EXCERPT_FALLBACK_LENGTH
    return `${content.slice(0, EXCERPT_FALLBACK_LENGTH).trim()}${truncated ? '…' : ''}`
  }

  if (source.keywords?.trim()) {
    return `Keywords: ${source.keywords.trim()}`
  }

  return source.title
}

/**
 * Scores every approved source against the question's terms and returns the
 * best matches (title matches ranked highest, then keywords, then content),
 * capped at MAX_CITATIONS. Empty array means "no source found" — callers
 * must not fabricate an answer in that case.
 */
export function findFallbackMatches(sources: KnowledgeSource[], questionText: string): FallbackMatch[] {
  const terms = tokenizeQuestion(questionText)
  if (terms.length === 0) return []

  const scored = sources.map((source) => {
    const title = source.title.toLowerCase()
    const keywords = (source.keywords ?? '').toLowerCase()
    const content = (source.content ?? '').toLowerCase()

    let score = 0
    for (const term of terms) {
      if (title.includes(term)) score += TITLE_WEIGHT
      if (keywords.includes(term)) score += KEYWORD_WEIGHT
      if (content.includes(term)) score += CONTENT_WEIGHT
    }

    return { source, score }
  })

  return scored
    .filter((entry) => entry.score > 0)
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score
      if (a.source.updatedAt !== b.source.updatedAt) {
        return a.source.updatedAt < b.source.updatedAt ? 1 : -1
      }
      return a.source.title.localeCompare(b.source.title)
    })
    .slice(0, MAX_CITATIONS)
    .map(({ source, score }) => ({ source, score, excerpt: buildExcerpt(source, terms) }))
}
