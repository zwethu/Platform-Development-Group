// "Ask my instructor", the instructor inbox, replies, unread badges, and
// turning a reply into an FAQ source. Real SQLite with all migrations applied.

import { describe, expect, it } from 'vitest'
import app from '../src/index'
import { createSqliteD1 } from './helpers/sqlite-d1'

const INSTRUCTOR = { id: 'instr-1', role: 'instructor' }
const STUDENT_A = { id: 'student-a', role: 'student' }
const STUDENT_B = { id: 'student-b', role: 'student' }
const COURSE = '1305308'

async function setup() {
  const { db, query } = createSqliteD1()
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

  await call(INSTRUCTOR, 'POST', '/courses', { id: COURSE, name: 'Platform Development' })
  await call(INSTRUCTOR, 'POST', '/sources', {
    courseId: COURSE, title: 'Week 6 — Webhooks', sourceType: 'notes',
    content: 'Webhooks are signed with HMAC-SHA-256 over the raw request body.',
  })
  const answered = (await call(STUDENT_A, 'POST', '/questions', { courseId: COURSE, questionText: 'How are webhooks signed?' })).data
  const unanswered = (await call(STUDENT_A, 'POST', '/questions', { courseId: COURSE, questionText: 'When is the midterm exam?' })).data
  return { call, query, answered, unanswered }
}

const inbox = (call: Awaited<ReturnType<typeof setup>>['call'], filter = 'open') =>
  call(INSTRUCTOR, 'GET', `/instructor/inbox?courseId=${COURSE}&filter=${filter}`)

describe('instructor inbox', () => {
  it('lists questions the assistant could not answer, not the answered ones', async () => {
    const { call, answered, unanswered } = await setup()
    expect(answered.question.status).toBe('answered')
    const res = await inbox(call)
    expect(res.status).toBe(200)
    expect(res.data.items.map((i: any) => i.question.id)).toEqual([unanswered.question.id])
    expect(res.data.items[0]).toMatchObject({ reasons: ['no_source_found'], replyCount: 0, studentRating: null })
    expect(res.data.items[0].question.studentId).toBe('student-a')
  })

  it('adds an answer the asking student rated 2 or lower — not one rated by an instructor', async () => {
    const { call, answered } = await setup()
    await call(INSTRUCTOR, 'POST', '/answers/feedback', { answerId: answered.answer.id, rating: 1 })
    expect((await inbox(call)).data.count).toBe(1)

    await call(STUDENT_A, 'POST', '/answers/feedback', { answerId: answered.answer.id, rating: 2 })
    const item = (await inbox(call)).data.items.find((i: any) => i.question.id === answered.question.id)
    expect(item).toMatchObject({ reasons: ['low_rating'], studentRating: 2 })
    expect(item.answer).toMatchObject({ id: answered.answer.id, mode: 'fallback' })
  })

  it('is for instructors only, needs a course, and validates the filter', async () => {
    const { call } = await setup()
    expect((await call(STUDENT_A, 'GET', `/instructor/inbox?courseId=${COURSE}`)).status).toBe(403)
    expect((await call(INSTRUCTOR, 'GET', '/instructor/inbox')).status).toBe(400)
    expect((await inbox(call, 'everything')).status).toBe(400)
  })
})

describe('Ask my instructor', () => {
  it('lets the student who asked escalate, with an optional note', async () => {
    const { call, answered } = await setup()
    const res = await call(STUDENT_A, 'POST', `/questions/${answered.question.id}/escalate`, { note: 'I still do not get the raw body part.' })
    expect(res.status).toBe(200)
    expect(res.data.escalatedAt).toBeTruthy()
    expect(res.data.escalationNote).toBe('I still do not get the raw body part.')

    const item = (await inbox(call)).data.items.find((i: any) => i.question.id === answered.question.id)
    expect(item.reasons).toEqual(['asked_instructor'])
    expect(item.question.escalationNote).toBe('I still do not get the raw body part.')
  })

  it('keeps the first escalation time when asked again, and accepts an empty body', async () => {
    const { call, answered } = await setup()
    const first = await call(STUDENT_A, 'POST', `/questions/${answered.question.id}/escalate`)
    expect(first.status).toBe(200)
    const second = await call(STUDENT_A, 'POST', `/questions/${answered.question.id}/escalate`, { note: 'still stuck' })
    expect(second.data.escalatedAt).toBe(first.data.escalatedAt)
    expect(second.data.escalationNote).toBe('still stuck')
  })

  it('refuses other students, instructors, unknown questions and long notes', async () => {
    const { call, answered } = await setup()
    const path = `/questions/${answered.question.id}/escalate`
    expect((await call(STUDENT_B, 'POST', path)).status).toBe(403)
    expect((await call(INSTRUCTOR, 'POST', path)).status).toBe(403)
    expect((await call(STUDENT_A, 'POST', '/questions/nope/escalate')).status).toBe(404)
    expect((await call(STUDENT_A, 'POST', path, { note: 'x'.repeat(501) })).status).toBe(400)
  })
})

describe('instructor replies', () => {
  it('shows the reply to the student, with an unread badge until they open it', async () => {
    const { call, unanswered } = await setup()
    const qid = unanswered.question.id
    const res = await call(INSTRUCTOR, 'POST', `/questions/${qid}/replies`, { content: 'The midterm is on 15 November.' })
    expect(res.status).toBe(201)
    expect(res.data.reply).toMatchObject({ questionId: qid, instructorId: 'instr-1', readAt: null, faqSourceId: null })
    expect(res.data.faqSource).toBeNull()

    let mine = await call(STUDENT_A, 'GET', '/me/questions')
    expect(mine.data.unreadReplies).toBe(1)
    expect(mine.data.items.find((q: any) => q.id === qid)).toMatchObject({ replyCount: 1, unreadReplies: 1 })

    // An instructor reading the question does not mark it read for the student.
    await call(INSTRUCTOR, 'GET', `/questions/${qid}`)
    expect((await call(STUDENT_A, 'GET', '/me/questions')).data.unreadReplies).toBe(1)

    const opened = await call(STUDENT_A, 'GET', `/questions/${qid}`)
    expect(opened.data.replies).toHaveLength(1)
    expect(opened.data.replies[0].content).toBe('The midterm is on 15 November.')

    mine = await call(STUDENT_A, 'GET', '/me/questions')
    expect(mine.data.unreadReplies).toBe(0)
  })

  it('moves a replied question out of the open inbox but keeps it under "all"', async () => {
    const { call, unanswered } = await setup()
    await call(INSTRUCTOR, 'POST', `/questions/${unanswered.question.id}/replies`, { content: 'See the course calendar.' })
    expect((await inbox(call)).data.count).toBe(0)
    const all = await inbox(call, 'all')
    expect(all.data.items[0]).toMatchObject({ replyCount: 1 })
  })

  it('keeps replies private to the student who asked', async () => {
    const { call, unanswered } = await setup()
    await call(INSTRUCTOR, 'POST', `/questions/${unanswered.question.id}/replies`, { content: 'Private answer.' })
    expect((await call(STUDENT_B, 'GET', `/questions/${unanswered.question.id}`)).status).toBe(403)
    expect((await call(STUDENT_B, 'GET', '/me/questions')).data.count).toBe(0)
  })

  it('is for instructors only and validates the reply', async () => {
    const { call, unanswered } = await setup()
    const path = `/questions/${unanswered.question.id}/replies`
    expect((await call(STUDENT_A, 'POST', path, { content: 'I answer myself' })).status).toBe(403)
    expect((await call(INSTRUCTOR, 'POST', path, { content: '   ' })).status).toBe(400)
    expect((await call(INSTRUCTOR, 'POST', path, { content: 'x'.repeat(2001) })).status).toBe(400)
    expect((await call(INSTRUCTOR, 'POST', path, { content: 'ok', addToSources: 'yes' })).status).toBe(400)
    expect((await call(INSTRUCTOR, 'POST', '/questions/nope/replies', { content: 'ok' })).status).toBe(404)
  })

  it('can add the reply to course materials, so the next student gets a cited answer', async () => {
    const { call, query, unanswered } = await setup()
    const res = await call(INSTRUCTOR, 'POST', `/questions/${unanswered.question.id}/replies`, {
      content: 'The midterm exam is on 15 November in room 301.',
      addToSources: true,
      faqQuestion: 'When is the midterm exam?',
    })
    expect(res.status).toBe(201)
    expect(res.data.faqSource).toMatchObject({ title: 'FAQ: When is the midterm exam?', courseId: COURSE })
    expect(res.data.reply.faqSourceId).toBe(res.data.faqSource.id)

    const [faq] = query('SELECT * FROM knowledge_sources WHERE id = ?', res.data.faqSource.id)
    expect(faq).toMatchObject({ source_type: 'faq', status: 'approved', created_by: 'instr-1' })
    expect(String(faq.content)).not.toContain('student-a') // no student identifier in shared material

    const next = await call(STUDENT_B, 'POST', '/questions', { courseId: COURSE, questionText: 'what date is the midterm exam' })
    expect(next.data.question.status).toBe('answered')
    expect(next.data.citations[0]).toMatchObject({ sourceTitle: 'FAQ: When is the midterm exam?' })
    expect(next.data.citations[0].excerpt).toContain('midterm')
    expect(next.data.answer.content).toContain('FAQ: When is the midterm exam?')
  })

  it('writes nothing when the FAQ question is invalid', async () => {
    const { call, query, unanswered } = await setup()
    const res = await call(INSTRUCTOR, 'POST', `/questions/${unanswered.question.id}/replies`, {
      content: 'Answer', addToSources: true, faqQuestion: 'x'.repeat(301),
    })
    expect(res.status).toBe(400)
    expect(query('SELECT COUNT(*) AS n FROM instructor_replies')[0].n).toBe(0)
  })
})

describe('my questions', () => {
  it('lists only the signed-in student’s questions, newest first, and is for students', async () => {
    const { call, answered, unanswered } = await setup()
    const res = await call(STUDENT_A, 'GET', '/me/questions')
    expect(res.data.items.map((q: any) => q.id)).toEqual([unanswered.question.id, answered.question.id])
    expect(res.data.items[1]).toMatchObject({ answerMode: 'fallback', replyCount: 0, escalatedAt: null })
    expect((await call(INSTRUCTOR, 'GET', '/me/questions')).status).toBe(403)
  })
})
