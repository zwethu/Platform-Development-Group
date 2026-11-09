// Learning Assistant UI — vanilla JS, no build step, served by the same Worker.
//
// Security notes (PRD §12, NFR-08):
// - Every piece of server or user data is rendered with textContent via h();
//   innerHTML is never used, so stored text cannot inject markup (XSS).
// - Only http(s) URLs become links (safeUrl), blocking javascript: URLs.
// - The page's CSP (public/_headers) allows scripts/styles/API calls from
//   this origin only.
// - The integration test key lives in sessionStorage only (cleared when the
//   tab closes) and is never shown again after entry.
'use strict'

/* ================================================================
   Small helpers
   ================================================================ */

/** Creates an element. Children are Nodes or text (always inserted as text). */
function h(tag, props, ...children) {
  const el = document.createElement(tag)
  let value
  for (const [key, val] of Object.entries(props || {})) {
    if (val == null || val === false) continue
    if (key === 'class') el.className = val
    else if (key === 'value') value = val
    else if (key.startsWith('on') && typeof val === 'function') el.addEventListener(key.slice(2).toLowerCase(), val)
    else if (val === true) el.setAttribute(key, '')
    else el.setAttribute(key, String(val))
  }
  for (const child of children.flat(Infinity)) {
    if (child == null || child === false) continue
    el.append(child instanceof Node ? child : document.createTextNode(String(child)))
  }
  if (value !== undefined) el.value = value
  return el
}

function safeUrl(url) {
  if (typeof url !== 'string') return null
  try {
    const parsed = new URL(url)
    return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? parsed.href : null
  } catch {
    return null
  }
}

const dateFmt = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' })
function fmtDate(iso) {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? String(iso ?? '') : dateFmt.format(d)
}

const store = {
  get(key, fallback) {
    try {
      const raw = localStorage.getItem(key)
      return raw == null ? fallback : JSON.parse(raw)
    } catch {
      return fallback
    }
  },
  set(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value))
    } catch {
      /* storage unavailable (private mode) — the app still works without it */
    }
  },
}

const session = {
  get(key) {
    try { return sessionStorage.getItem(key) ?? '' } catch { return '' }
  },
  set(key, value) {
    try { sessionStorage.setItem(key, value) } catch { /* ignore */ }
  },
}

let toastTimer
function toast(message, kind = 'ok') {
  const el = document.getElementById('toast')
  el.textContent = message
  el.className = kind === 'bad' ? 'toast bad' : 'toast'
  el.hidden = false
  clearTimeout(toastTimer)
  toastTimer = setTimeout(() => { el.hidden = true }, 3500)
}

/* ================================================================
   State
   ================================================================ */

const QUESTION_MIN = 3
const QUESTION_MAX = 1000
const COMMENT_MAX = 500
const DEFAULT_COURSE = '1305308'
const CAREER_COURSE = 'CAREER'

const state = {
  role: store.get('la.role', 'student'),
  userId: store.get('la.userId', 'student-a'),
  courseId: store.get('la.courseId', DEFAULT_COURSE),
  // Set from GET /v1/auth/config at boot. 'identity' = sign in with Student
  // Identity (Team 01); 'demo-headers' = local development role switcher.
  authMode: 'identity',
  identityUrl: null,
}

// Student Identity session: only the short-lived token (and its expiry) is
// kept, in sessionStorage, so it disappears when the tab closes. The
// password is never stored and never sent to the Learning Assistant server.
const ID_SESSION_KEY = 'la.identitySession'

function getIdSession() {
  try {
    const s = JSON.parse(sessionStorage.getItem(ID_SESSION_KEY) || 'null')
    if (s && s.exp && s.exp * 1000 <= Date.now()) {
      sessionStorage.removeItem(ID_SESSION_KEY)
      return null
    }
    return s
  } catch {
    return null
  }
}

function setIdSession(session) {
  try {
    if (session) sessionStorage.setItem(ID_SESSION_KEY, JSON.stringify(session))
    else sessionStorage.removeItem(ID_SESSION_KEY)
  } catch { /* storage unavailable: the user signs in again next time */ }
}

/** Reads `exp` from a JWT for display/expiry only; the server verifies tokens with Student Identity. */
function tokenExpiry(token) {
  try {
    const payload = JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')))
    return typeof payload.exp === 'number' ? payload.exp : null
  } catch {
    return null
  }
}

function isSignedIn() {
  return state.authMode === 'demo-headers' || Boolean(getIdSession() && state.signedIn)
}

function signOut(message) {
  setIdSession(null)
  state.signedIn = false
  renderAuthStatus()
  if (message) toast(message, 'bad')
  location.hash = '#/signin'
}

function setCourse(courseId) {
  state.courseId = courseId
  store.set('la.courseId', courseId)
}

// Questions a user has asked from this browser. There is no "list my
// questions" endpoint yet, so the UI remembers ids locally and re-reads each
// one from the API (which re-checks ownership) when opened.
function historyKey() { return `la.history.${state.userId}` }
function getHistory() { return store.get(historyKey(), []) }
function addHistory(entry) {
  const rest = getHistory().filter((e) => e.id !== entry.id)
  store.set(historyKey(), [entry, ...rest].slice(0, 50))
}
function findHistory(id) { return getHistory().find((e) => e.id === id) }

/* ================================================================
   API client
   ================================================================ */

class ApiError extends Error {
  constructor(status, code, message, correlationId) {
    super(message)
    this.status = status
    this.code = code
    this.correlationId = correlationId
  }
}

/**
 * Calls the /v1 API. Identity headers are added unless auth is false.
 * Non-2xx responses throw ApiError, except statuses listed in `allow`.
 */
async function api(path, { method = 'GET', body, auth = true, headers = {}, allow = [] } = {}) {
  const hdrs = { ...headers }
  if (auth && state.authMode === 'identity') {
    const session = getIdSession()
    if (session) hdrs.Authorization = `Bearer ${session.token}`
  } else if (auth) {
    hdrs['x-user-id'] = state.userId
    hdrs['x-user-role'] = state.role
  }
  if (body !== undefined) hdrs['content-type'] = 'application/json'

  let res
  try {
    res = await fetch(path, { method, headers: hdrs, body: body === undefined ? undefined : JSON.stringify(body) })
  } catch {
    throw new ApiError(0, 'NETWORK', 'Could not reach the server. Check your connection and try again.', null)
  }

  const correlationId = res.headers.get('x-correlation-id')
  let json = null
  try { json = await res.json() } catch { /* empty or non-JSON body */ }

  if (!res.ok && !allow.includes(res.status)) {
    const err = json && json.error
    if (res.status === 401 && auth && state.authMode === 'identity' && state.signedIn) {
      signOut('Your sign-in has expired. Please sign in again.')
    }
    throw new ApiError(
      res.status,
      (err && err.code) || `HTTP_${res.status}`,
      (err && err.message) || `Request failed with HTTP ${res.status}.`,
      (err && err.correlationId) || correlationId,
    )
  }
  return { status: res.status, data: json && 'data' in json ? json.data : json, correlationId }
}

function errorBox(err) {
  const friendly = {
    401: 'You need a valid identity (role and user ID) to do this.',
    403: 'Your current role or user is not allowed to do this.',
    404: 'Not found.',
  }
  const message = err instanceof ApiError ? err.message || friendly[err.status] : String(err && err.message ? err.message : err)
  return h('div', { class: 'error-box', role: 'alert' },
    h('div', null, message),
    err instanceof ApiError && err.status
      ? h('div', { class: 'tiny' }, `HTTP ${err.status} · ${err.code}`, err.correlationId ? ` · correlation id ${err.correlationId}` : '')
      : null,
  )
}

function busy(button, label) {
  const original = Array.from(button.childNodes)
  button.disabled = true
  button.replaceChildren(h('span', { class: 'spinner', 'aria-hidden': 'true' }), label)
  return () => {
    button.disabled = false
    button.replaceChildren(...original)
  }
}

/* ================================================================
   Router & shell
   ================================================================ */

const NAV = {
  student: [
    ['#/ask', 'Ask a question'],
    ['#/questions', 'My questions'],
    ['#/sources', 'Course materials'],
    ['#/integration', 'Internships'],
    ['#/status', 'System status'],
  ],
  instructor: [
    ['#/sources', 'Knowledge sources'],
    ['#/questions', 'Questions'],
    ['#/integration', 'Team 17 integration'],
    ['#/status', 'System status'],
  ],
}

const ROUTES = [
  [/^#\/signin$/, () => viewSignIn()],
  [/^#\/ask$/, () => viewAsk()],
  [/^#\/questions$/, () => viewQuestions()],
  [/^#\/questions\/([^/]+)$/, (m) => viewQuestion(decodeURIComponent(m[1]))],
  [/^#\/sources$/, () => viewSources()],
  [/^#\/integration$/, () => viewIntegration()],
  [/^#\/status$/, () => viewStatus()],
]

function homeRoute() { return state.role === 'instructor' ? '#/sources' : '#/ask' }

const view = () => document.getElementById('view')
let renderToken = 0

/** Replaces the main view, unless a newer navigation has started meanwhile. */
function mount(token, ...nodes) {
  if (token !== renderToken) return false
  view().replaceChildren(...nodes)
  return true
}

const SIGNED_OUT_NAV = [['#/signin', 'Sign in'], ['#/status', 'System status']]
const PUBLIC_ROUTES = ['#/signin', '#/status']

function renderNav() {
  const current = location.hash.startsWith('#/questions/') ? '#/questions' : location.hash
  document.getElementById('nav').replaceChildren(
    ...(isSignedIn() ? NAV[state.role] : SIGNED_OUT_NAV).map(([href, label]) =>
      h('a', { href, 'aria-current': href === current ? 'page' : null }, label)),
  )
}

function route() {
  const hash = location.hash
  if (!isSignedIn() && !PUBLIC_ROUTES.includes(hash)) {
    location.replace('#/signin')
    return
  }
  if (isSignedIn() && hash === '#/signin') {
    location.replace(homeRoute())
    return
  }
  const match = ROUTES.map(([re, fn]) => [hash.match(re), fn]).find(([m]) => m)
  if (!match) {
    location.replace(homeRoute())
    return
  }
  renderToken += 1
  renderNav()
  window.scrollTo(0, 0)
  match[1](match[0])
}

function pageHead(title, subtitle) {
  return h('div', { class: 'page-head' }, h('h1', null, title), subtitle ? h('p', null, subtitle) : null)
}

function loading(text = 'Loading…') {
  return h('div', { class: 'muted actions' }, h('span', { class: 'spinner', 'aria-hidden': 'true' }), text)
}

/* ================================================================
   Shared pieces: course picker, status pills, answer rendering
   ================================================================ */

function coursePicker(onChange, { label = 'Course ID' } = {}) {
  const input = h('input', { id: 'course-id', value: state.courseId, required: true, maxlength: 64, spellcheck: 'false', autocomplete: 'off' })
  const form = h('form', { class: 'field-row', onSubmit: (e) => {
    e.preventDefault()
    const value = input.value.trim()
    if (!value) return
    setCourse(value)
    onChange(value)
  } },
    h('div', { class: 'field' }, h('label', { for: 'course-id' }, label), input),
    h('div', { class: 'field' }, h('span', { class: 'label', 'aria-hidden': 'true' }, ' '),
      h('button', { type: 'submit', class: 'btn btn-secondary' }, 'Load')),
  )
  return form
}

function questionStatusPill(status) {
  const map = {
    answered: ['Answered', 'pill-ok'],
    no_source_found: ['No approved source', 'pill-warn'],
    pending: ['Pending', ''],
    failed: ['Failed', 'pill-bad'],
  }
  const [label, cls] = map[status] || [status, '']
  return h('span', { class: `pill ${cls}` }, label)
}

const FALLBACK_REASONS = {
  disabled: 'AI answers are turned off',
  over_budget: "today's AI budget for this course is used up",
  timeout: 'the AI took too long to respond',
  model_error: 'the AI service is unavailable',
  invalid_output: 'the AI reply was not in the expected format',
  invalid_citation: "the AI reply cited material it wasn't given",
  not_covered: "the approved materials don't cover this question",
}

function modePill(mode) {
  return mode === 'ai'
    ? h('span', { class: 'pill pill-ai' }, 'AI answer · cited')
    : h('span', { class: 'pill pill-accent' }, 'Keyword search')
}

/** Splits answer text on [n] markers and turns each into a jump-to-citation button. */
function answerText(content, citationCount, scope) {
  const p = h('p', { class: 'answer-body' })
  const parts = content.split(/(\[\d+\])/g)
  for (const part of parts) {
    const m = part.match(/^\[(\d+)\]$/)
    const n = m ? Number(m[1]) : 0
    if (m && n >= 1 && n <= citationCount) {
      p.append(h('button', {
        type: 'button', class: 'cite-ref', 'aria-label': `Go to source ${n}`,
        onClick: () => {
          const target = scope.querySelector(`[data-cite="${n}"]`)
          if (!target) return
          target.scrollIntoView({ behavior: 'smooth', block: 'center' })
          target.classList.add('flash')
          setTimeout(() => target.classList.remove('flash'), 1400)
        },
      }, String(n)))
    } else {
      p.append(document.createTextNode(part))
    }
  }
  return p
}

function citationList(citations) {
  if (!citations.length) return null
  return h('ol', { class: 'citations', 'aria-label': 'Sources cited' },
    citations.map((c, i) => {
      const url = safeUrl(c.sourceUrl)
      const title = c.sourceTitle || 'Approved course source'
      return h('li', { class: 'citation', 'data-cite': i + 1 },
        h('span', { class: 'citation-num', 'aria-hidden': 'true' }, String(i + 1)),
        h('div', null,
          h('div', { class: 'citation-title' },
            url ? h('a', { href: url, target: '_blank', rel: 'noopener noreferrer' }, title) : title),
          h('blockquote', { class: 'citation-excerpt' }, c.excerpt),
        ),
      )
    }),
  )
}

/** Full answer card: question, answer with citation markers, sources, feedback. */
function answerCard({ question, answer, citations = [], generation }) {
  const card = h('article', { class: 'card', 'aria-label': 'Answer' })
  const mode = (generation && generation.mode) || (answer && answer.mode)

  card.append(
    h('div', { class: 'card-head' },
      h('div', { class: 'pill-row' }, questionStatusPill(question.status), answer ? modePill(mode) : null),
      h('span', { class: 'tiny' }, `${question.courseId} · ${fmtDate(question.createdAt)}`),
    ),
    h('p', { class: 'question-quote' }, question.questionText),
  )

  if (!answer) {
    card.append(h('div', { class: 'notice notice-warn' }, 'This question has no stored answer yet.'))
    return card
  }

  if (answer.noSourceFound) {
    card.append(
      h('p', { class: 'answer-body' }, answer.content),
      h('div', { class: 'notice notice-warn' },
        'Nothing in this course’s approved materials covers this question, so no answer was generated. ',
        'Try rephrasing with terms from your course materials, or ask your instructor.'),
    )
  } else {
    card.append(answerText(answer.content, citations.length, card))
    if (mode === 'ai') {
      card.append(h('div', { class: 'notice notice-info' },
        'Generated by AI using only the cited, instructor-approved materials. Check the sources below.',
        generation && generation.model ? h('div', { class: 'tiny' }, `Model: ${generation.model}`) : null))
    } else {
      const reason = generation && generation.fallbackReason ? FALLBACK_REASONS[generation.fallbackReason] : null
      card.append(h('div', { class: 'notice notice-info' },
        'This is a keyword search over approved course materials, not an AI-generated explanation.',
        reason ? h('div', { class: 'tiny' }, `AI not used because ${reason}.`) : null))
    }
  }

  if (citations.length) {
    card.append(h('div', { class: 'section-title' }, `Sources (${citations.length})`), citationList(citations))
  }

  card.append(feedbackForm(answer.id))
  return card
}

function feedbackForm(answerId) {
  const name = `rating-${answerId}`
  const result = h('div', { 'aria-live': 'polite' })
  const comment = h('textarea', { id: `comment-${answerId}`, maxlength: COMMENT_MAX, rows: 2, placeholder: 'Optional — what was helpful or missing?' })
  const counter = h('div', { class: 'counter' }, `0 / ${COMMENT_MAX}`)
  comment.addEventListener('input', () => { counter.textContent = `${comment.value.length} / ${COMMENT_MAX}` })
  const submit = h('button', { type: 'submit', class: 'btn btn-secondary' }, 'Send feedback')

  const form = h('form', { onSubmit: async (e) => {
    e.preventDefault()
    const picked = form.querySelector(`input[name="${name}"]:checked`)
    if (!picked) {
      result.replaceChildren(h('div', { class: 'notice notice-warn' }, 'Choose a rating from 1 to 5 first.'))
      return
    }
    const done = busy(submit, 'Saving…')
    try {
      const text = comment.value.trim()
      const { status, data } = await api('/v1/answers/feedback', {
        method: 'POST',
        body: { answerId, rating: Number(picked.value), comment: text ? text : null },
      })
      result.replaceChildren(h('div', { class: 'notice notice-ok' },
        status === 201
          ? `Thanks! Your rating (${data.rating}/5) was saved. You can change it at any time.`
          : `Your rating was updated to ${data.rating}/5.`))
    } catch (err) {
      result.replaceChildren(errorBox(err))
    } finally {
      done()
    }
  } },
    h('div', { class: 'section-title' }, 'Was this helpful?'),
    h('fieldset', { class: 'rating' },
      h('legend', { class: 'sr-only' }, 'Rating from 1 (not helpful) to 5 (very helpful)'),
      [1, 2, 3, 4, 5].map((n) => [
        h('input', { type: 'radio', name, id: `${name}-${n}`, value: n }),
        h('label', { for: `${name}-${n}`, title: n === 1 ? 'Not helpful' : n === 5 ? 'Very helpful' : null }, String(n)),
      ]),
    ),
    h('div', { class: 'field' }, h('label', { for: `comment-${answerId}` }, 'Comment'), comment, counter),
    h('div', { class: 'actions' }, submit, h('span', { class: 'tiny' }, '1 = not helpful · 5 = very helpful')),
    result,
  )
  return form
}

/* ================================================================
   View: Ask a question (student)
   ================================================================ */

function viewAsk() {
  const token = renderToken
  const isStudent = state.role === 'student'

  const sourcesPanel = h('div', null, loading())
  const result = h('div', { class: 'stack' })

  const courseInput = h('input', { id: 'ask-course', value: state.courseId, required: true, maxlength: 64, spellcheck: 'false', autocomplete: 'off' })
  const textarea = h('textarea', { id: 'ask-text', rows: 4, maxlength: QUESTION_MAX, required: true, placeholder: 'e.g. How should a webhook be signed?' })
  const counter = h('div', { class: 'counter', id: 'ask-counter' }, `0 / ${QUESTION_MAX}`)
  const submit = h('button', { type: 'submit', class: 'btn', disabled: !isStudent }, 'Ask')

  textarea.addEventListener('input', () => {
    const len = textarea.value.trim().length
    counter.textContent = `${len} / ${QUESTION_MAX}`
    counter.classList.toggle('over', len > QUESTION_MAX)
    textarea.removeAttribute('aria-invalid')
  })

  async function loadSources(courseId) {
    sourcesPanel.replaceChildren(loading())
    try {
      const { data } = await api(`/v1/courses/${encodeURIComponent(courseId)}/sources`)
      sourcesPanel.replaceChildren(
        data.items.length
          ? h('ul', { class: 'compact-list' }, data.items.map((s) => h('li', null, s.title)))
          : h('div', { class: 'empty' }, 'No approved materials in this course yet.'),
        h('p', { class: 'tiny' }, `${data.count} approved source${data.count === 1 ? '' : 's'}. Answers only use these.`),
      )
    } catch (err) {
      sourcesPanel.replaceChildren(errorBox(err))
    }
  }

  courseInput.addEventListener('change', () => {
    const value = courseInput.value.trim()
    if (value) { setCourse(value); loadSources(value) }
  })

  const form = h('form', { class: 'card', 'aria-labelledby': 'ask-title', onSubmit: async (e) => {
    e.preventDefault()
    const courseId = courseInput.value.trim()
    const questionText = textarea.value.trim()
    if (questionText.length < QUESTION_MIN || questionText.length > QUESTION_MAX) {
      textarea.setAttribute('aria-invalid', 'true')
      result.replaceChildren(h('div', { class: 'notice notice-warn', role: 'alert' },
        `Your question must be between ${QUESTION_MIN} and ${QUESTION_MAX} characters.`))
      return
    }
    setCourse(courseId)
    const done = busy(submit, 'Searching approved materials…')
    result.replaceChildren(h('div', { class: 'card' }, loading('Finding relevant course materials and preparing a cited answer — this can take a few seconds.')))
    try {
      const { data } = await api('/v1/questions', { method: 'POST', body: { courseId, questionText } })
      addHistory({
        id: data.question.id,
        courseId: data.question.courseId,
        questionText: data.question.questionText,
        status: data.question.status,
        createdAt: data.question.createdAt,
        generation: data.generation,
      })
      result.replaceChildren(
        answerCard(data),
        h('p', { class: 'tiny' }, 'Saved to ', h('a', { href: '#/questions' }, 'My questions'), '.'),
      )
      textarea.value = ''
      counter.textContent = `0 / ${QUESTION_MAX}`
    } catch (err) {
      result.replaceChildren(errorBox(err))
    } finally {
      done()
      if (!isStudent) submit.disabled = true
    }
  } },
    h('h2', { id: 'ask-title' }, 'Ask a question'),
    isStudent ? null : h('div', { class: 'notice notice-warn' }, 'Only students can ask questions. Switch the role at the top to Student.'),
    h('div', { class: 'field' }, h('label', { for: 'ask-course' }, 'Course ID'), courseInput),
    h('div', { class: 'field' },
      h('label', { for: 'ask-text' }, 'Your question'),
      textarea,
      h('div', { class: 'actions' }, h('span', { class: 'hint' }, `${QUESTION_MIN}–${QUESTION_MAX} characters`), counter),
    ),
    h('div', { class: 'actions' }, submit),
  )

  mount(token,
    pageHead('Ask a question', 'Answers come only from your instructor’s approved course materials, and every answer shows its sources.'),
    h('div', { class: 'grid grid-main-side' },
      h('div', { class: 'stack' }, form, result),
      h('aside', { class: 'card', 'aria-labelledby': 'side-title' }, h('h2', { id: 'side-title' }, 'Approved materials'), sourcesPanel),
    ),
  )
  loadSources(state.courseId)
}

/* ================================================================
   View: My questions / open by id
   ================================================================ */

function viewQuestions() {
  const token = renderToken
  const isStudent = state.role === 'student'
  const history = getHistory()

  const idInput = h('input', { id: 'open-id', required: true, spellcheck: 'false', autocomplete: 'off', placeholder: 'Question ID' })
  const openForm = h('form', { class: 'card', onSubmit: (e) => {
    e.preventDefault()
    const id = idInput.value.trim()
    if (id) location.hash = `#/questions/${encodeURIComponent(id)}`
  } },
    h('h2', null, 'Open a question by ID'),
    h('p', { class: 'muted small' }, isStudent
      ? 'Students can open their own questions only.'
      : 'Instructors can open any student’s question.'),
    h('div', { class: 'field-row' },
      h('div', { class: 'field' }, h('label', { for: 'open-id' }, 'Question ID'), idInput),
      h('div', { class: 'field' }, h('span', { class: 'label', 'aria-hidden': 'true' }, ' '), h('button', { type: 'submit', class: 'btn btn-secondary' }, 'Open')),
    ),
  )

  const list = history.length
    ? h('ul', { class: 'list' }, history.map((q) =>
        h('li', null, h('a', { class: 'list-link', href: `#/questions/${encodeURIComponent(q.id)}` },
          h('div', { class: 'list-item' },
            h('div', { class: 'list-item-head' },
              h('span', { class: 'list-item-title' }, q.questionText),
              h('div', { class: 'pill-row' },
                questionStatusPill(q.status),
                q.generation ? modePill(q.generation.mode) : null),
            ),
            h('div', { class: 'meta' }, h('span', null, q.courseId), h('span', null, fmtDate(q.createdAt))),
          )))))
    : h('div', { class: 'empty' }, isStudent
        ? h('span', null, 'No questions yet. ', h('a', { href: '#/ask' }, 'Ask your first question'), '.')
        : 'Questions you ask as a student from this browser appear here.')

  mount(token,
    pageHead(isStudent ? 'My questions' : 'Questions', isStudent
      ? `Questions asked as ${state.userId} from this browser.`
      : 'Look up any question and its cited answer by ID.'),
    h('div', { class: 'grid grid-main-side' },
      h('section', { class: 'card', 'aria-labelledby': 'hist-title' },
        h('div', { class: 'card-head' },
          h('h2', { id: 'hist-title' }, 'Recent questions'),
          history.length ? h('button', { type: 'button', class: 'btn btn-secondary btn-small', onClick: () => {
            store.set(historyKey(), [])
            route()
          } }, 'Clear list') : null),
        list),
      openForm,
    ),
  )
}

async function viewQuestion(id) {
  const token = renderToken
  mount(token, pageHead('Question'), loading())
  try {
    const { data } = await api(`/v1/questions/${encodeURIComponent(id)}`)
    const cached = findHistory(id)
    mount(token,
      pageHead('Question', `Question ID ${data.question.id}`),
      h('div', { class: 'stack' },
        answerCard({ ...data, generation: cached && cached.generation }),
        h('p', null, h('a', { href: '#/questions' }, '← Back to questions')),
      ),
    )
  } catch (err) {
    mount(token, pageHead('Question'), errorBox(err), h('p', null, h('a', { href: '#/questions' }, '← Back to questions')))
  }
}

/* ================================================================
   View: Knowledge sources (instructor manages, student browses)
   ================================================================ */

const SOURCE_TYPES = ['document', 'slides', 'notes', 'link', 'video', 'other']

function viewSources() {
  const token = renderToken
  const isInstructor = state.role === 'instructor'
  const listBox = h('div', null, loading())
  let editing = null // the source being edited, or null when adding

  const f = {
    title: h('input', { id: 'src-title', required: true, maxlength: 200 }),
    type: h('select', { id: 'src-type' }, SOURCE_TYPES.map((t) => h('option', { value: t }, t))),
    url: h('input', { id: 'src-url', type: 'url', placeholder: 'https://…', maxlength: 2000 }),
    content: h('textarea', { id: 'src-content', rows: 6, placeholder: 'Paste the text students should be able to get answers from.' }),
    keywords: h('input', { id: 'src-keywords', placeholder: 'rest, api, http', maxlength: 500 }),
  }
  const formTitle = h('h2', { id: 'src-form-title' }, 'Add a knowledge source')
  const formMsg = h('div', { 'aria-live': 'polite' })
  const submit = h('button', { type: 'submit', class: 'btn' }, 'Add source')
  const cancel = h('button', { type: 'button', class: 'btn btn-secondary', hidden: true, onClick: () => resetForm() }, 'Cancel')

  function resetForm() {
    editing = null
    f.title.value = ''
    f.type.value = 'document'
    f.url.value = ''
    f.content.value = ''
    f.keywords.value = ''
    formTitle.textContent = 'Add a knowledge source'
    submit.textContent = 'Add source'
    cancel.hidden = true
    formMsg.replaceChildren()
  }

  function startEdit(source) {
    editing = source
    f.title.value = source.title
    f.type.value = SOURCE_TYPES.includes(source.sourceType) ? source.sourceType : 'other'
    if (!SOURCE_TYPES.includes(source.sourceType)) {
      f.type.append(h('option', { value: source.sourceType }, source.sourceType))
      f.type.value = source.sourceType
    }
    f.url.value = source.sourceUrl || ''
    f.content.value = source.content || ''
    f.keywords.value = source.keywords || ''
    formTitle.textContent = 'Edit knowledge source'
    submit.textContent = 'Save changes'
    cancel.hidden = false
    formMsg.replaceChildren()
    form.scrollIntoView({ behavior: 'smooth', block: 'start' })
    f.title.focus({ preventScroll: true })
  }

  const form = h('form', { class: 'card', 'aria-labelledby': 'src-form-title', onSubmit: async (e) => {
    e.preventDefault()
    const url = f.url.value.trim()
    if (url && !safeUrl(url)) {
      formMsg.replaceChildren(h('div', { class: 'notice notice-warn' }, 'The link must start with http:// or https://.'))
      return
    }
    const body = {
      title: f.title.value.trim(),
      sourceType: f.type.value,
      sourceUrl: url || null,
      content: f.content.value.trim() || null,
      keywords: f.keywords.value.split(',').map((k) => k.trim()).filter(Boolean),
    }
    const done = busy(submit, editing ? 'Saving…' : 'Adding…')
    try {
      if (editing) {
        await api(`/v1/sources/${encodeURIComponent(editing.id)}`, { method: 'PATCH', body })
        toast('Source updated')
      } else {
        await api('/v1/sources', { method: 'POST', body: { courseId: state.courseId, ...body } })
        toast('Source added and approved')
      }
      done()
      resetForm()
      loadList()
    } catch (err) {
      done()
      formMsg.replaceChildren(errorBox(err))
    }
  } },
    formTitle,
    h('p', { class: 'muted small' }, 'New sources are approved immediately and become available to students’ questions in this course.'),
    h('div', { class: 'field' }, h('label', { for: 'src-title' }, 'Title'), f.title),
    h('div', { class: 'field-row' },
      h('div', { class: 'field' }, h('label', { for: 'src-type' }, 'Type'), f.type),
      h('div', { class: 'field' }, h('label', { for: 'src-url' }, 'Link (optional)'), f.url),
    ),
    h('div', { class: 'field' }, h('label', { for: 'src-content' }, 'Content'), f.content,
      h('span', { class: 'hint' }, 'Answers quote from this text.')),
    h('div', { class: 'field' }, h('label', { for: 'src-keywords' }, 'Keywords'), f.keywords,
      h('span', { class: 'hint' }, 'Comma-separated. Helps keyword matching.')),
    h('div', { class: 'actions' }, submit, cancel),
    formMsg,
  )

  async function archive(source, button) {
    if (!confirm(`Archive “${source.title}”?\n\nStudents will no longer get answers from it. Existing answers keep their citations.`)) return
    const done = busy(button, 'Archiving…')
    try {
      await api(`/v1/sources/${encodeURIComponent(source.id)}`, { method: 'DELETE' })
      toast('Source archived')
      if (editing && editing.id === source.id) resetForm()
      loadList()
    } catch (err) {
      done()
      toast(err.message, 'bad')
    }
  }

  function sourceItem(s) {
    const url = safeUrl(s.sourceUrl)
    const editBtn = h('button', { type: 'button', class: 'btn btn-secondary btn-small', onClick: () => startEdit(s) }, 'Edit')
    const archiveBtn = h('button', { type: 'button', class: 'btn btn-danger btn-small' }, 'Archive')
    archiveBtn.addEventListener('click', () => archive(s, archiveBtn))
    return h('li', { class: 'list-item' },
      h('div', { class: 'list-item-head' },
        h('span', { class: 'list-item-title' }, s.title),
        isInstructor ? h('div', { class: 'actions' }, editBtn, archiveBtn) : null,
      ),
      h('div', { class: 'meta' },
        h('span', { class: 'chip' }, s.sourceType),
        s.keywords ? h('span', null, `Keywords: ${s.keywords}`) : null,
        h('span', null, `Updated ${fmtDate(s.updatedAt)}`),
        isInstructor ? h('span', null, `by ${s.createdBy}`) : null,
      ),
      url ? h('div', { class: 'meta' }, h('a', { href: url, target: '_blank', rel: 'noopener noreferrer' }, url)) : null,
      s.content ? h('details', null, h('summary', null, 'Show content'), h('p', { class: 'preview' }, s.content)) : null,
    )
  }

  async function loadList() {
    listBox.replaceChildren(loading())
    try {
      const { data } = await api(`/v1/courses/${encodeURIComponent(state.courseId)}/sources`)
      listBox.replaceChildren(
        h('p', { class: 'tiny' }, `${data.count} approved source${data.count === 1 ? '' : 's'} in ${state.courseId}`),
        data.items.length
          ? h('ul', { class: 'list' }, data.items.map(sourceItem))
          : h('div', { class: 'empty' }, isInstructor ? 'No approved sources yet — add the first one.' : 'No approved materials in this course yet.'),
      )
    } catch (err) {
      listBox.replaceChildren(errorBox(err))
    }
  }

  const listCard = h('section', { class: 'card', 'aria-labelledby': 'src-list-title' },
    h('h2', { id: 'src-list-title' }, isInstructor ? 'Approved sources' : 'Approved materials'),
    coursePicker(() => { resetForm(); loadList() }),
    listBox,
  )

  mount(token,
    pageHead(isInstructor ? 'Knowledge sources' : 'Course materials', isInstructor
      ? 'Manage the approved materials the assistant may answer from. Archiving hides a source from new answers but keeps history.'
      : 'These instructor-approved materials are the only places answers come from.'),
    isInstructor ? h('div', { class: 'grid grid-two' }, form, listCard) : listCard,
  )
  if (isInstructor) resetForm()
  loadList()
}

/* ================================================================
   View: Team 17 integration
   ================================================================ */

function viewIntegration() {
  const token = renderToken
  const isStudent = state.role === 'student'
  const statusBox = h('div', null, loading())
  const internshipsBox = h('div', null, loading())

  async function loadStatus() {
    try {
      const { data } = await api('/v1/integration/status', { auth: false })
      statusBox.replaceChildren(
        h('dl', { class: 'kv' },
          h('dt', null, 'Our service'), h('dd', null, data.service),
          h('dt', null, 'Status'), h('dd', null, h('span', { class: `pill ${data.status === 'ok' ? 'pill-ok' : 'pill-warn'}` }, data.status)),
          h('dt', null, 'Partner'), h('dd', null, data.integration.partner),
          h('dt', null, 'Inbound webhook'), h('dd', null, h('code', null, `POST ${data.integration.inboundWebhook}`)),
          h('dt', null, 'Checked'), h('dd', null, fmtDate(data.timestamp)),
        ),
      )
    } catch (err) {
      statusBox.replaceChildren(errorBox(err))
    }
  }

  async function loadInternships() {
    try {
      const { data } = await api(`/v1/courses/${CAREER_COURSE}/sources`)
      const items = data.items.filter((s) => s.sourceType === 'internship_opportunity')
      internshipsBox.replaceChildren(
        items.length
          ? h('ul', { class: 'list' }, items.map((s) => {
              const url = safeUrl(s.sourceUrl)
              return h('li', { class: 'list-item' },
                h('div', { class: 'list-item-head' },
                  h('span', { class: 'list-item-title' }, s.title),
                  h('span', { class: 'pill pill-accent' }, 'From Team 17')),
                s.content ? h('p', { class: 'preview' }, s.content) : null,
                h('div', { class: 'meta' },
                  h('span', null, `Received ${fmtDate(s.createdAt)}`),
                  url ? h('a', { href: url, target: '_blank', rel: 'noopener noreferrer' }, 'View posting') : null),
              )
            }))
          : h('div', { class: 'empty' }, 'No internship opportunities received yet. They appear here when Team 17 publishes one.'),
      )
    } catch (err) {
      internshipsBox.replaceChildren(errorBox(err))
    }
  }

  const askCareer = isStudent
    ? h('button', { type: 'button', class: 'btn btn-secondary btn-small', onClick: () => {
        setCourse(CAREER_COURSE)
        location.hash = '#/ask'
      } }, 'Ask about internships')
    : null

  mount(token,
    pageHead(isStudent ? 'Internship opportunities' : 'Team 17 integration',
      'Team 17 (Internship) publishes new opportunities to us by signed webhook. Each one becomes an approved source in the CAREER course, so students can ask about it.'),
    h('div', { class: 'stack' },
      h('section', { class: 'card', 'aria-labelledby': 'flow-title' },
        h('h2', { id: 'flow-title' }, 'How it works'),
        h('div', { class: 'flow', 'aria-label': 'Integration flow' },
          h('span', { class: 'flow-step' }, 'Team 17 publishes an internship'),
          h('span', { class: 'flow-arrow', 'aria-hidden': 'true' }, '→'),
          h('span', { class: 'flow-step' }, 'HMAC-signed webhook'),
          h('span', { class: 'flow-arrow', 'aria-hidden': 'true' }, '→'),
          h('span', { class: 'flow-step' }, 'Signature + duplicate check'),
          h('span', { class: 'flow-arrow', 'aria-hidden': 'true' }, '→'),
          h('span', { class: 'flow-step' }, 'Approved CAREER source'),
          h('span', { class: 'flow-arrow', 'aria-hidden': 'true' }, '→'),
          h('span', { class: 'flow-step' }, 'Students ask, answers cite it'),
        ),
        statusBox,
      ),
      h('section', { class: 'card', 'aria-labelledby': 'intern-title' },
        h('div', { class: 'card-head' }, h('h2', { id: 'intern-title' }, 'Opportunities received'), askCareer),
        internshipsBox,
      ),
      isStudent ? null : outboundCard(),
    ),
  )
  loadStatus()
  loadInternships()
}

function outboundCard() {
  const keyInput = h('input', { id: 'it-key', type: 'password', autocomplete: 'off', value: session.get('la.integrationKey') })
  const box = h('div', { 'aria-live': 'polite' })
  const loadBtn = h('button', { type: 'submit', class: 'btn btn-secondary' }, 'Load deliveries')
  const sendBtn = h('button', { type: 'button', class: 'btn btn-danger' }, 'Send test event to Team 17')

  function keyHeaders() {
    const key = keyInput.value.trim()
    session.set('la.integrationKey', key)
    return { 'X-Integration-Test-Key': key }
  }

  async function loadDeliveries() {
    if (!keyInput.value.trim()) {
      box.replaceChildren(h('div', { class: 'notice notice-warn' }, 'Enter the integration test key first.'))
      return
    }
    const done = busy(loadBtn, 'Loading…')
    try {
      const { data } = await api('/v1/integrations/team17/deliveries', { auth: false, headers: keyHeaders() })
      box.replaceChildren(data.length
        ? h('div', { class: 'table-wrap' }, h('table', null,
            h('thead', null, h('tr', null, ['Attempted', 'Event', 'Result', 'Partner HTTP', 'Error'].map((t) => h('th', { scope: 'col' }, t)))),
            h('tbody', null, data.map((d) => h('tr', null,
              h('td', null, fmtDate(d.attemptedAt)),
              h('td', null, h('code', null, d.eventId)),
              h('td', null, h('span', { class: `pill ${d.status === 'delivered' ? 'pill-ok' : d.status === 'failed' ? 'pill-bad' : ''}` }, d.status)),
              h('td', null, d.responseStatus == null ? '—' : String(d.responseStatus)),
              h('td', null, d.errorMessage || '—'),
            ))),
          ))
        : h('div', { class: 'empty' }, 'No outbound deliveries recorded yet.'))
    } catch (err) {
      box.replaceChildren(errorBox(err))
    } finally {
      done()
    }
  }

  sendBtn.addEventListener('click', async () => {
    if (!keyInput.value.trim()) {
      box.replaceChildren(h('div', { class: 'notice notice-warn' }, 'Enter the integration test key first.'))
      return
    }
    if (!confirm('This sends a real partner.updated event to Team 17’s live server and records the attempt. Continue?')) return
    const done = busy(sendBtn, 'Sending…')
    try {
      const { status, data } = await api('/v1/integrations/team17/test-send', {
        method: 'POST', auth: false, headers: keyHeaders(), body: {}, allow: [502],
      })
      toast(status === 200 ? `Delivered to Team 17 (HTTP ${data.partnerStatus})` : 'Team 17 did not accept the event — see the log', status === 200 ? 'ok' : 'bad')
      done()
      loadDeliveries()
    } catch (err) {
      done()
      box.replaceChildren(errorBox(err))
    }
  })

  return h('section', { class: 'card', 'aria-labelledby': 'out-title' },
    h('h2', { id: 'out-title' }, 'Outbound: Team 08 → Team 17'),
    h('p', { class: 'muted small' }, 'Operator tool. Requires the integration test key (kept only for this browser tab). Every attempt is logged — secrets and headers are never stored.'),
    h('form', { onSubmit: (e) => { e.preventDefault(); loadDeliveries() } },
      h('div', { class: 'field' }, h('label', { for: 'it-key' }, 'Integration test key'), keyInput),
      h('div', { class: 'actions' }, loadBtn, sendBtn),
    ),
    h('div', { class: 'section-title' }, 'Recent deliveries'),
    box,
  )
}

/* ================================================================
   View: System status (deep health)
   ================================================================ */

function viewStatus() {
  const token = renderToken
  const box = h('div', null, loading())
  const probeBtn = h('button', { type: 'button', class: 'btn btn-secondary btn-small' }, 'Run AI check (1 model call)')
  const refreshBtn = h('button', { type: 'button', class: 'btn btn-secondary btn-small' }, 'Refresh')

  const CHECK_LABELS = { database: 'Database (D1 + tables)', ai: 'Workers AI', ai_budget: 'AI daily budget' }
  const statusClass = (s) => (s === 'ok' || s === 'pass' ? 'pill-ok' : s === 'degraded' || s === 'warn' ? 'pill-warn' : 'pill-bad')

  async function load(probe) {
    const button = probe ? probeBtn : refreshBtn
    const done = busy(button, probe ? 'Checking AI…' : 'Refreshing…')
    try {
      const { data } = await api(`/v1/health/ready${probe ? '?probe=ai' : ''}`, { auth: false, allow: [503] })
      box.replaceChildren(
        h('div', { class: 'big-status' },
          h('span', { class: `pill ${statusClass(data.status)}` }, data.status === 'ok' ? 'All systems operational' : `Service ${data.status}`),
          h('span', { class: 'tiny' }, `Checked ${fmtDate(data.timestamp)}`)),
        h('p', { class: 'muted small' }, data.answerPath === 'ai_with_fallback'
          ? 'Questions get AI answers with citations, with keyword search as the fallback.'
          : 'Questions are answered by keyword search only (AI path unavailable).'),
        h('div', { class: 'table-wrap' }, h('table', null,
          h('thead', null, h('tr', null, ['Check', 'Status', 'Latency', 'Detail'].map((t) => h('th', { scope: 'col' }, t)))),
          h('tbody', null, Object.entries(data.checks).map(([name, check]) => h('tr', null,
            h('td', null, CHECK_LABELS[name] || name),
            h('td', null, h('span', { class: `pill ${statusClass(check.status)}` }, check.status)),
            h('td', null, check.latencyMs == null ? '—' : `${check.latencyMs} ms`),
            h('td', null, h('code', null, check.detail ? JSON.stringify(check.detail) : check.error || '—')),
          ))),
        )),
      )
    } catch (err) {
      box.replaceChildren(errorBox(err))
    } finally {
      done()
    }
  }

  probeBtn.addEventListener('click', () => load(true))
  refreshBtn.addEventListener('click', () => load(false))

  mount(token,
    pageHead('System status', 'Live readiness of the API, its database, and the AI answer path.'),
    h('section', { class: 'card', 'aria-labelledby': 'health-title' },
      h('div', { class: 'card-head' }, h('h2', { id: 'health-title' }, 'Readiness'), h('div', { class: 'actions' }, refreshBtn, probeBtn)),
      box,
    ),
  )
  load(false)
}

/* ================================================================
   Boot
   ================================================================ */

function initIdentity() {
  const form = document.getElementById('identity')
  const role = document.getElementById('identity-role')
  const user = document.getElementById('identity-user')
  role.value = state.role
  user.value = state.userId

  role.addEventListener('change', () => {
    // Suggest a matching demo user when switching roles.
    if (role.value === 'instructor' && user.value.startsWith('student')) user.value = 'instr-1'
    if (role.value === 'student' && user.value.startsWith('instr')) user.value = 'student-a'
  })

  form.addEventListener('submit', (e) => {
    e.preventDefault()
    const id = user.value.trim()
    if (!id) return
    const roleChanged = role.value !== state.role
    state.role = role.value
    state.userId = id
    store.set('la.role', state.role)
    store.set('la.userId', state.userId)
    toast(`Now acting as ${state.userId} (${state.role})`)
    if (roleChanged && !NAV[state.role].some(([href]) => href === location.hash)) location.hash = homeRoute()
    else route()
  })
}

/* ================================================================
   Student Identity sign-in (identity mode)
   ================================================================ */

/** Header area: the demo switcher in demo mode, or who is signed in with Student Identity. */
function renderAuthStatus() {
  const demoForm = document.getElementById('identity')
  const status = document.getElementById('auth-status')
  const banner = document.getElementById('demo-banner')
  const demo = state.authMode === 'demo-headers'
  demoForm.hidden = !demo
  banner.hidden = !demo
  status.hidden = demo
  if (demo) return
  status.replaceChildren(...(state.signedIn
    ? [
        h('span', { class: 'auth-who' },
          h('span', { class: 'auth-id' }, state.userId),
          h('span', { class: `pill ${state.role === 'instructor' ? 'pill-ai' : 'pill-accent'}` }, state.role)),
        h('button', { type: 'button', class: 'btn btn-secondary btn-small', onClick: () => signOut() }, 'Sign out'),
      ]
    : [h('a', { class: 'btn btn-small', href: '#/signin' }, 'Sign in')]))
}

/** Asks our server who the token belongs to (it verifies the token with Student Identity). */
async function loadSignedInUser() {
  const { data } = await api('/v1/me')
  state.userId = data.id
  state.role = data.role
  state.signedIn = true
  renderAuthStatus()
}

function viewSignIn() {
  const token = renderToken
  const idInput = h('input', { id: 'si-student-id', inputmode: 'numeric', maxlength: 10, required: true, autocomplete: 'username', placeholder: '10-digit student ID' })
  const pwInput = h('input', { id: 'si-password', type: 'password', required: true, maxlength: 1024, autocomplete: 'current-password' })
  const msg = h('div', { 'aria-live': 'polite' })
  const submit = h('button', { type: 'submit', class: 'btn' }, 'Sign in')
  const identityUrl = state.identityUrl

  const form = h('form', { class: 'card', 'aria-labelledby': 'signin-title', onSubmit: async (e) => {
    e.preventDefault()
    const done = busy(submit, 'Signing in…')
    // Student Identity runs on free hosting that sleeps; the first request can take a while.
    const slow = setTimeout(() => msg.replaceChildren(h('div', { class: 'notice notice-info' },
      'Waking up Student Identity — the first sign-in can take up to a minute.')), 4000)
    try {
      let res
      try {
        res = await fetch(`${identityUrl}/auth/login`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ studentId: idInput.value.trim(), password: pwInput.value }),
        })
      } catch {
        throw new ApiError(0, 'NETWORK', 'Could not reach Student Identity. Check your connection and try again.', null)
      }
      const json = await res.json().catch(() => null)
      if (!res.ok || !json || typeof json.token !== 'string') {
        throw new ApiError(res.status, 'SIGN_IN_FAILED',
          (json && (json.error || json.message)) || 'Sign-in failed. Check your student ID and password.', null)
      }
      setIdSession({ token: json.token, exp: tokenExpiry(json.token) })
      await loadSignedInUser()
      toast(`Signed in as ${state.userId} (${state.role})`)
      location.hash = homeRoute()
    } catch (err) {
      if (!(err instanceof ApiError && err.code === 'SIGN_IN_FAILED')) setIdSession(null)
      state.signedIn = false
      msg.replaceChildren(errorBox(err))
    } finally {
      clearTimeout(slow)
      pwInput.value = '' // never keep the password around
      done()
    }
  } },
    h('h2', { id: 'signin-title' }, 'Sign in with Student Identity'),
    h('p', { class: 'muted small' },
      'Use your university Student Identity account (Team 01). Your password goes directly from this browser to Student Identity over HTTPS — the Learning Assistant never receives or stores it.'),
    h('div', { class: 'field' }, h('label', { for: 'si-student-id' }, 'Student ID'), idInput),
    h('div', { class: 'field' }, h('label', { for: 'si-password' }, 'Password'), pwInput),
    h('div', { class: 'actions' }, submit,
      identityUrl ? h('a', { href: identityUrl, target: '_blank', rel: 'noopener noreferrer', class: 'small' }, 'No account? Create one on Student Identity') : null),
    msg,
  )

  mount(token,
    pageHead('Welcome to the Learning Assistant', 'Ask questions about your courses and get answers drawn only from your instructors’ approved materials, with sources.'),
    h('div', { class: 'grid grid-main-side' }, form,
      h('aside', { class: 'card' },
        h('h2', null, 'How sign-in works'),
        h('ul', { class: 'compact-list' },
          h('li', null, 'Student Identity checks your password and gives this tab a short-lived sign-in token.'),
          h('li', null, 'Our server confirms that token with Student Identity on your requests.'),
          h('li', null, 'Students ask questions; instructors manage course materials.'),
          h('li', null, 'Closing the tab signs you out.')))),
  )
  idInput.focus()
}

/* ================================================================
   Start
   ================================================================ */

document.getElementById('skip-link').addEventListener('click', (e) => {
  e.preventDefault()
  view().focus()
})

async function boot() {
  try {
    const { data } = await api('/v1/auth/config', { auth: false })
    state.authMode = data.mode === 'demo-headers' ? 'demo-headers' : 'identity'
    state.identityUrl = data.identityProvider ? data.identityProvider.url : null
  } catch {
    state.authMode = 'identity' // fail closed: never fall back to unsigned headers
  }

  if (state.authMode === 'demo-headers') {
    state.signedIn = true
    initIdentity()
  } else if (getIdSession()) {
    try {
      await loadSignedInUser() // restores a sign-in that is still valid in this tab
    } catch {
      setIdSession(null)
      state.signedIn = false
    }
  }
  renderAuthStatus()
  window.addEventListener('hashchange', route)
  route()
}

boot()
