# API Demo — Responses

**Scope:** local only, captured from `npx wrangler dev --local` on
`http://127.0.0.1:8787`, using the requests in `api-demo-requests.md`.
IDs below are real UUIDs generated during this local run against
fictional demo data (course `SE101`, users `instructor-demo`,
`student-demo-a`, `student-demo-b`) — no real student data.

## A. Health check

```
HTTP 200
{"status":"ok","service":"learning-assistant"}
```

## B. Create an approved source (instructor)

```
HTTP 201
{
  "data": {
    "id": "1c64b637-c8b9-4375-8727-017040c20c59",
    "courseId": "SE101",
    "title": "Week 3 REST API Lecture Notes",
    "sourceType": "document",
    "sourceUrl": "https://example.edu/se101/week-3-rest",
    "storageKey": null,
    "content": "REST is an architectural style for networked applications. REST APIs commonly use HTTP methods such as GET, POST, PATCH, and DELETE.",
    "keywords": "REST, API, HTTP, GET, POST",
    "status": "approved",
    "createdBy": "instructor-demo",
    "createdAt": "2026-09-20T16:36:49.397Z",
    "updatedAt": "2026-09-20T16:36:49.397Z"
  }
}
```

## C. Draft source is excluded from listing

Draft create → `HTTP 201`, `"status": "draft"`.

Listing as `student-demo-a` right after:

```
HTTP 200
{
  "data": {
    "items": [
      {
        "id": "1c64b637-c8b9-4375-8727-017040c20c59",
        "title": "Week 3 REST API Lecture Notes",
        "status": "approved",
        "...": "(remaining fields as in B)"
      }
    ],
    "count": 1
  }
}
```

The draft source does **not** appear — only the approved one is listed.

## D. Update the approved source

```
HTTP 200
{
  "data": {
    "id": "1c64b637-c8b9-4375-8727-017040c20c59",
    "title": "Week 3 REST API Lecture Notes (Revised)",
    "keywords": "REST, API, HTTP, GET, POST, PATCH, DELETE",
    "status": "approved",
    "updatedAt": "2026-09-20T16:37:00.989Z",
    "...": "(other fields unchanged from B)"
  }
}
```

`updatedAt` advanced; `createdAt`, `courseId`, and `createdBy` are unchanged.

## E. Matching question → fallback answer + citation

```
HTTP 201
{
  "data": {
    "question": {
      "id": "aa9a7fb1-4029-415a-bc08-f0523d691b46",
      "courseId": "SE101",
      "studentId": "student-demo-a",
      "questionText": "What is REST and which HTTP methods are commonly used?",
      "status": "answered",
      "createdAt": "2026-09-20T16:37:14.754Z",
      "updatedAt": "2026-09-20T16:37:14.809Z"
    },
    "answer": {
      "id": "ec7b4163-0c0b-42e0-9cdb-538d692fb1aa",
      "questionId": "aa9a7fb1-4029-415a-bc08-f0523d691b46",
      "content": "Based on the approved course materials, the following source(s) appear relevant to your question:\n\n1. Week 3 REST API Lecture Notes (Revised) — \"REST is an architectural style for networked applications. REST API…\"",
      "mode": "fallback",
      "noSourceFound": false,
      "createdAt": "2026-09-20T16:37:14.799Z"
    },
    "citations": [
      {
        "id": "d2e006bd-e10b-41ff-b934-87aba9b9dea2",
        "answerId": "ec7b4163-0c0b-42e0-9cdb-538d692fb1aa",
        "sourceId": "1c64b637-c8b9-4375-8727-017040c20c59",
        "excerpt": "REST is an architectural style for networked applications. REST API…",
        "location": null,
        "score": 16,
        "createdAt": "2026-09-20T16:37:14.799Z"
      }
    ],
    "note": "This is a deterministic keyword search over approved course materials, not an AI-generated explanation."
  }
}
```

Question id: `aa9a7fb1-4029-415a-bc08-f0523d691b46`
Answer id: `ec7b4163-0c0b-42e0-9cdb-538d692fb1aa`

## F. Question ownership / authorization

| Caller | Result |
|---|---|
| `student-demo-a` (owner) | `HTTP 200` |
| `student-demo-b` (not owner) | `HTTP 403` — `{"error":{"code":"FORBIDDEN","message":"You do not have access to this question.","correlationId":"57bf34c4-56be-4f92-b799-2ecdab01cc68"}}` |
| `instructor-demo` | `HTTP 200` |

## G. Submit answer feedback

```
HTTP 201
{
  "data": {
    "id": "a38ea0de-6df3-4985-b5bc-c393fc2a6af7",
    "answerId": "ec7b4163-0c0b-42e0-9cdb-538d692fb1aa",
    "userId": "student-demo-a",
    "rating": 5,
    "comment": "The cited source was helpful.",
    "createdAt": "2026-09-20T16:37:15.019Z"
  }
}
```

## H. No-match question → safe no-source-found response

```
HTTP 201
{
  "data": {
    "question": {
      "id": "663cf61e-eeef-42c2-80ad-f213c69567fd",
      "questionText": "Where can I check my exam schedule?",
      "status": "no_source_found",
      "...": "(other fields as usual)"
    },
    "answer": {
      "id": "d149c85a-f562-4ec5-9660-ea0d2f9d239a",
      "content": "I could not find an answer in the approved materials for this course. Please check with your instructor.",
      "mode": "fallback",
      "noSourceFound": true,
      "createdAt": "2026-09-20T16:37:44.361Z"
    },
    "citations": [],
    "note": "This is a deterministic keyword search over approved course materials, not an AI-generated explanation."
  }
}
```

No fabricated answer, and `citations` is empty, as required.

## I. Archive the approved source, then re-list

Archive:

```
HTTP 200
{ "data": { "id": "1c64b637-c8b9-4375-8727-017040c20c59", "status": "archived", "...": "..." } }
```

Re-list as `student-demo-a`:

```
HTTP 200
{ "data": { "items": [], "count": 0 } }
```

The archived source no longer appears in the approved listing.

## J. Re-archive the same source (idempotency)

```
HTTP 200
{ "data": { "id": "1c64b637-c8b9-4375-8727-017040c20c59", "status": "archived", "updatedAt": "2026-09-20T16:37:54.881Z" } }
```

Archiving an already-archived source still succeeds with `200` and
returns the source — no error, no duplicate side effect.
