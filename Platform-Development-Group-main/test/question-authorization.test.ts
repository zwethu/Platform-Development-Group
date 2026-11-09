import { describe, expect, it } from 'vitest'
import { canViewQuestion } from '../src/routes/questions'
import type { AuthUser, Question } from '../src/lib/types'

function makeQuestion(overrides: Partial<Question> = {}): Question {
  return {
    id: 'q1',
    courseId: 'SE101',
    studentId: 'student-a',
    questionText: 'What is REST?',
    status: 'answered',
    escalatedAt: null,
    escalationNote: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  }
}

describe('canViewQuestion', () => {
  it('allows an instructor to view any question', () => {
    const instructor: AuthUser = { id: 'instructor-1', role: 'instructor' }
    expect(canViewQuestion(instructor, makeQuestion({ studentId: 'someone-else' }))).toBe(true)
  })

  it('allows a student to view their own question', () => {
    const student: AuthUser = { id: 'student-a', role: 'student' }
    expect(canViewQuestion(student, makeQuestion({ studentId: 'student-a' }))).toBe(true)
  })

  it('denies a student viewing another student\'s question', () => {
    const student: AuthUser = { id: 'student-b', role: 'student' }
    expect(canViewQuestion(student, makeQuestion({ studentId: 'student-a' }))).toBe(false)
  })
})
