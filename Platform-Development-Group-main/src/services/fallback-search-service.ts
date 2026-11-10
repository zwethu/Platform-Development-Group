// Deterministic, keyword-only search over approved knowledge sources. No
// LLM, no vector search — matches question terms against a source's title
// and keywords, and against the text of each of its chunks (passages of
// about 1,000 characters, see ./chunking.ts).
//
// Ranking a chunk instead of a whole source means a 40-slide deck is cited by
// the slide that matches ("Slide 14"), and the AI is given that passage
// rather than only the beginning of the document. Sources without chunks
// (older rows, or the Team 17 webhook) are treated as a single chunk made of
// their `content`, which keeps their previous behaviour unchanged.

import type { KnowledgeSource, SourceChunk } from '../lib/types'

export interface FallbackMatch {
  source: KnowledgeSource
  excerpt: string
  score: number
  /** The matched passage's text: what the AI model reads. Null when the source has no text, only a title/keywords. */
  passage?: string | null
  /** Page / slide / section label of the matched passage, e.g. "Slide 14". */
  location?: string | null
}

const TITLE_WEIGHT = 3
const KEYWORD_WEIGHT = 2
const CONTENT_WEIGHT = 1
const MAX_CITATIONS = 3
/** Keeps answers from citing three slides of one deck when another source also matches. */
const MAX_CHUNKS_PER_SOURCE = 2
const MIN_TERM_LENGTH = 2
const EXCERPT_CONTEXT_CHARS = 60
const EXCERPT_FALLBACK_LENGTH = 160

// Words that appear in almost every question and passage. Without this list
// "When is the midterm?" matches any source containing "the" (terms are
// matched as substrings), so nothing would ever be "no source found".
const STOP_WORDS = new Set(
  (
    'a an and are as at be been being but by can could did do does for from had has have how i if in into is it its ' +
    'me my no not of on or our please should so than that the their them then there these they this those to ' +
    'was we were what when where which who whom whose why will with would you your explain tell about also just'
  ).split(' '),
)

export function tokenizeQuestion(text: string): string[] {
  const terms = text
    .toLowerCase()
    .split(/[^a-z0-9]+/i)
    .map((term) => term.trim())
    // Single digits stay: "week 3" must not match every "Week N" source equally.
    .filter((term) => (term.length >= MIN_TERM_LENGTH || /^\d$/.test(term)) && !STOP_WORDS.has(term))

  return Array.from(new Set(terms))
}

/** Where `term` occurs in `text` (-1 if not). Numbers match whole numbers only, so "3" never hits "13" or "2023". */
function termIndex(text: string, term: string): number {
  if (!/^\d+$/.test(term)) return text.indexOf(term)
  return text.search(new RegExp(`(?<!\\d)${term}(?!\\d)`))
}

/** Always returns a non-empty, bounded-length excerpt, even without content. */
function buildExcerpt(source: KnowledgeSource, text: string | null, terms: string[]): string {
  const content = text?.trim()

  if (content) {
    const lower = content.toLowerCase()
    const matchedTerm = terms.find((term) => termIndex(lower, term) >= 0)

    if (matchedTerm) {
      const index = termIndex(lower, matchedTerm)
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

interface Candidate {
  source: KnowledgeSource
  text: string | null
  location: string | null
  position: number
  score: number
}

/**
 * Scores every chunk of every approved source against the question's terms
 * and returns the best matches (title matches ranked highest, then keywords,
 * then passage text), at most MAX_CHUNKS_PER_SOURCE per source and
 * MAX_CITATIONS overall. Empty array means "no source found" — callers must
 * not fabricate an answer in that case.
 */
export function findChunkMatches(sources: KnowledgeSource[], chunks: SourceChunk[], questionText: string): FallbackMatch[] {
  const terms = tokenizeQuestion(questionText)
  if (terms.length === 0) return []

  const chunksBySource = new Map<string, SourceChunk[]>()
  for (const chunk of chunks) {
    const list = chunksBySource.get(chunk.sourceId) ?? []
    list.push(chunk)
    chunksBySource.set(chunk.sourceId, list)
  }

  const candidates: Candidate[] = []
  for (const source of sources) {
    const title = source.title.toLowerCase()
    const keywords = (source.keywords ?? '').toLowerCase()
    let sourceScore = 0
    for (const term of terms) {
      if (termIndex(title, term) >= 0) sourceScore += TITLE_WEIGHT
      if (termIndex(keywords, term) >= 0) sourceScore += KEYWORD_WEIGHT
    }

    const own = chunksBySource.get(source.id)
    const passages = own?.length
      ? own.map((c) => ({ text: c.content, location: c.location, position: c.position }))
      : [{ text: source.content, location: null, position: 0 }]

    for (const passage of passages) {
      const content = (passage.text ?? '').toLowerCase()
      let score = sourceScore
      for (const term of terms) {
        if (termIndex(content, term) >= 0) score += CONTENT_WEIGHT
      }
      if (score > 0) candidates.push({ source, ...passage, score })
    }
  }

  candidates.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score
    if (a.source.updatedAt !== b.source.updatedAt) {
      return a.source.updatedAt < b.source.updatedAt ? 1 : -1
    }
    const byTitle = a.source.title.localeCompare(b.source.title)
    return byTitle !== 0 ? byTitle : a.position - b.position
  })

  const perSource = new Map<string, number>()
  const picked: Candidate[] = []
  for (const candidate of candidates) {
    const used = perSource.get(candidate.source.id) ?? 0
    if (used >= MAX_CHUNKS_PER_SOURCE) continue
    perSource.set(candidate.source.id, used + 1)
    picked.push(candidate)
    if (picked.length === MAX_CITATIONS) break
  }

  return picked.map(({ source, text, location, score }) => ({
    source,
    score,
    passage: text,
    location,
    excerpt: buildExcerpt(source, text, terms),
  }))
}

/** Search over sources' own `content` only (no chunks). */
export function findFallbackMatches(sources: KnowledgeSource[], questionText: string): FallbackMatch[] {
  return findChunkMatches(sources, [], questionText)
}
