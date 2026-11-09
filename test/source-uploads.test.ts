// Uploaded course files (PDF/PPTX/DOCX text) and chunked search.
// Runs against real SQLite with all migrations applied (helpers/sqlite-d1.ts).

import { describe, expect, it } from 'vitest'
import app from '../src/index'
import { createSqliteD1 } from './helpers/sqlite-d1'
import { chunkSegments, normalizeText, splitIntoChunks, CHUNK_MAX_CHARS } from '../src/services/chunking'
import { buildUserMessage } from '../src/services/ai-answer-service'
import { createSource } from '../src/repositories/sources-repository'

const INSTRUCTOR = { id: 'instr-1', role: 'instructor' }
const STUDENT = { id: 'student-a', role: 'student' }
const COURSE = '1305308'

function setup() {
  const { db, query } = createSqliteD1()
  query(`INSERT INTO courses (id, name, status, created_by, created_at, updated_at) VALUES (?, 'Platform Development', 'active', 'instr-1', '2026-11-01', '2026-11-01')`, COURSE)
  const env = { AUTH_MODE: 'demo-headers', learning_assistant_db: db }
  const call = async (user: { id: string; role: string }, method: string, path: string, body?: unknown) => {
    const res = await app.request(
      `/v1${path}`,
      {
        method,
        headers: { 'x-user-id': user.id, 'x-user-role': user.role, 'content-type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
      },
      env,
    )
    const json = (await res.json()) as { data?: any; error?: { code: string; message: string } }
    return { status: res.status, data: json.data, error: json.error }
  }
  return { db, query, call }
}

const DECK = {
  courseId: COURSE,
  title: 'Week 6 slides',
  sourceType: 'slides',
  fileName: 'week6-integration.pptx',
  segments: [
    { location: 'Slide 1', text: 'Week 6\nIntegration patterns' },
    { location: 'Slide 2', text: 'Webhooks are signed with HMAC-SHA-256 over the raw request body.' },
    { location: 'Slide 3', text: '' }, // a picture-only slide
    { location: 'Slide 4', text: 'Idempotency keys let a consumer safely ignore a retried event.' },
  ],
}

describe('chunking', () => {
  it('normalizes whitespace but keeps paragraph breaks', () => {
    expect(normalizeText('  a\t\tb  \r\n\r\n\r\n\r\nc  ')).toBe('a b\n\nc')
  })

  it('packs paragraphs into chunks no longer than the limit', () => {
    const paragraph = 'Sentence about REST APIs. '.repeat(30).trim() // ~780 chars
    const chunks = splitIntoChunks([paragraph, paragraph, paragraph].join('\n\n'))
    expect(chunks).toHaveLength(3)
    for (const chunk of chunks) expect(chunk.length).toBeLessThanOrEqual(CHUNK_MAX_CHARS)
  })

  it('splits one very long paragraph at sentence ends', () => {
    const chunks = splitIntoChunks('Short sentence here. '.repeat(200))
    expect(chunks.length).toBeGreaterThan(3)
    for (const chunk of chunks) {
      expect(chunk.length).toBeLessThanOrEqual(CHUNK_MAX_CHARS)
      expect(chunk.endsWith('.')).toBe(true)
    }
  })

  it('keeps each segment’s page/slide label and skips empty segments', () => {
    const chunks = chunkSegments(DECK.segments)
    expect(chunks.map((c) => [c.position, c.location])).toEqual([
      [0, 'Slide 1'],
      [1, 'Slide 2'],
      [2, 'Slide 4'],
    ])
  })

  it('gives the AI the matched passage, labelled with its slide', () => {
    const message = buildUserMessage('q', [
      {
        source: { title: 'Deck', content: 'whole deck text', keywords: null } as never,
        excerpt: '',
        score: 1,
        passage: 'only slide two',
        location: 'Slide 2',
      },
    ])
    expect(message).toContain('title="Deck — Slide 2"')
    expect(message).toContain('only slide two')
    expect(message).not.toContain('whole deck text')
  })
})

describe('uploading a file’s text', () => {
  it('stores the source with its file name and one chunk per slide with text', async () => {
    const { call, query } = setup()
    const res = await call(INSTRUCTOR, 'POST', '/sources', DECK)
    expect(res.status).toBe(201)
    expect(res.data).toMatchObject({ fileName: 'week6-integration.pptx', segmentCount: 4, chunkCount: 3, content: null })

    const rows = query('SELECT location FROM source_chunks WHERE source_id = ? ORDER BY position', res.data.id)
    expect(rows.map((r) => r.location)).toEqual(['Slide 1', 'Slide 2', 'Slide 4'])

    const list = await call(STUDENT, 'GET', `/courses/${COURSE}/sources`)
    expect(list.data.items[0]).toMatchObject({ title: 'Week 6 slides', fileName: 'week6-integration.pptx' })
  })

  it('lets anyone signed in read the extracted text of an approved source', async () => {
    const { call } = setup()
    const { data: source } = await call(INSTRUCTOR, 'POST', '/sources', DECK)
    const res = await call(STUDENT, 'GET', `/sources/${source.id}/chunks`)
    expect(res.status).toBe(200)
    expect(res.data.count).toBe(3)
    expect(res.data.items[1]).toEqual({
      position: 1,
      location: 'Slide 2',
      content: 'Webhooks are signed with HMAC-SHA-256 over the raw request body.',
    })
  })

  it('cites the slide that answers the question', async () => {
    const { call } = setup()
    await call(INSTRUCTOR, 'POST', '/sources', DECK)
    const res = await call(STUDENT, 'POST', '/questions', { courseId: COURSE, questionText: 'How is a webhook signed with HMAC?' })
    expect(res.status).toBe(201)
    expect(res.data.question.status).toBe('answered')
    expect(res.data.citations[0]).toMatchObject({ sourceTitle: 'Week 6 slides', location: 'Slide 2' })
    expect(res.data.citations[0].excerpt).toContain('HMAC-SHA-256')
    expect(res.data.answer.content).toContain('Week 6 slides (Slide 2)')

    // The stored citation keeps the location too.
    const again = await call(STUDENT, 'GET', `/questions/${res.data.question.id}`)
    expect(again.data.citations[0].location).toBe('Slide 2')
  })

  it('cites at most two passages from the same file', async () => {
    const { call } = setup()
    await call(INSTRUCTOR, 'POST', '/sources', {
      ...DECK,
      segments: Array.from({ length: 5 }, (_, i) => ({ location: `Page ${i + 1}`, text: `REST resources page ${i + 1}` })),
      fileName: 'rest.pdf',
    })
    const res = await call(STUDENT, 'POST', '/questions', { courseId: COURSE, questionText: 'What are REST resources?' })
    expect(res.data.citations).toHaveLength(2)
  })

  it('only allows instructors to upload', async () => {
    const { call } = setup()
    const res = await call(STUDENT, 'POST', '/sources', DECK)
    expect(res.status).toBe(403)
  })

  it.each([
    ['an unsupported file type', { fileName: 'notes.ppt' }, 'Only .pdf, .pptx, .docx'],
    ['a file with no text (scanned)', { segments: [{ location: 'Page 1', text: '   ' }] }, 'No text was found'],
    ['both typed text and a file', { content: 'typed' }, 'not both'],
    ['no segments', { segments: [] }, 'non-empty array'],
    ['text over the size limit', { segments: [{ location: 'Page 1', text: 'x '.repeat(130_000) }] }, 'too long'],
    ['too many pages', { segments: Array.from({ length: 1001 }, () => ({ location: 'p', text: 'a' })) }, 'at most 1000'],
    ['a location that is too long', { segments: [{ location: 'L'.repeat(101), text: 'a' }] }, 'location must be at most'],
    ['a segment without text', { segments: [{ location: 'Page 1' }] }, 'text must be a string'],
  ])('rejects %s', async (_label, override, message) => {
    const { call, query } = setup()
    const res = await call(INSTRUCTOR, 'POST', '/sources', { ...DECK, ...override })
    expect(res.status).toBe(400)
    expect(res.error?.message).toContain(message)
    expect(query('SELECT COUNT(*) AS n FROM knowledge_sources')[0].n).toBe(0)
  })

  it('does not allow editing an uploaded file’s text, but allows its title', async () => {
    const { call } = setup()
    const { data: source } = await call(INSTRUCTOR, 'POST', '/sources', DECK)
    const bad = await call(INSTRUCTOR, 'PATCH', `/sources/${source.id}`, { content: 'new text' })
    expect(bad.status).toBe(400)
    expect(bad.error?.message).toContain('upload the new version')
    const ok = await call(INSTRUCTOR, 'PATCH', `/sources/${source.id}`, { title: 'Week 6 — Integration' })
    expect(ok.status).toBe(200)
    expect(ok.data.title).toBe('Week 6 — Integration')
  })

  it('stops using an archived file and hides it from students', async () => {
    const { call } = setup()
    const { data: source } = await call(INSTRUCTOR, 'POST', '/sources', DECK)
    await call(INSTRUCTOR, 'DELETE', `/sources/${source.id}`)
    const res = await call(STUDENT, 'POST', '/questions', { courseId: COURSE, questionText: 'How is a webhook signed?' })
    expect(res.data.question.status).toBe('no_source_found')
    expect((await call(STUDENT, 'GET', `/sources/${source.id}/chunks`)).status).toBe(404)
    expect((await call(INSTRUCTOR, 'GET', `/sources/${source.id}/chunks`)).status).toBe(200)
  })
})

describe('typed-text sources are chunked too', () => {
  it('finds a passage deep inside long pasted text', async () => {
    const { call } = setup()
    const filler = Array.from({ length: 10 }, (_, i) => `Paragraph ${i} about unrelated database topics. `.repeat(15)).join('\n\n')
    await call(INSTRUCTOR, 'POST', '/sources', {
      courseId: COURSE,
      title: 'Course handbook',
      sourceType: 'document',
      content: `${filler}\n\nThe final exam is on 10 December in room 301.`,
    })
    const res = await call(STUDENT, 'POST', '/questions', { courseId: COURSE, questionText: 'When is the final exam?' })
    expect(res.data.citations[0].excerpt).toContain('10 December')
  })

  it('re-chunks the text when an instructor edits it', async () => {
    const { call, query } = setup()
    const { data: source } = await call(INSTRUCTOR, 'POST', '/sources', {
      courseId: COURSE, title: 'Notes', sourceType: 'notes', content: 'Old text about caching.',
    })
    await call(INSTRUCTOR, 'PATCH', `/sources/${source.id}`, { content: 'New text about kubernetes pods.' })
    expect(query('SELECT content FROM source_chunks WHERE source_id = ?', source.id)).toEqual([
      { content: 'New text about kubernetes pods.' },
    ])
    const res = await call(STUDENT, 'POST', '/questions', { courseId: COURSE, questionText: 'What are kubernetes pods?' })
    expect(res.data.question.status).toBe('answered')
  })

  it('still searches older sources that have no chunks', async () => {
    const { db, call } = setup()
    const now = new Date().toISOString()
    await createSource(db, {
      id: 'legacy-1', courseId: COURSE, title: 'Legacy notes', sourceType: 'notes', sourceUrl: null, storageKey: null,
      content: 'GraphQL lets a client choose the fields it needs.', keywords: null, status: 'approved',
      createdBy: 'instr-1', createdAt: now, updatedAt: now,
    })
    const res = await call(STUDENT, 'POST', '/questions', { courseId: COURSE, questionText: 'What is GraphQL?' })
    expect(res.data.citations[0]).toMatchObject({ sourceId: 'legacy-1', location: null })
  })
})
