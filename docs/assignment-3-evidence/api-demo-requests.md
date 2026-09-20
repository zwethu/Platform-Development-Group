# API Demo — Requests

**Scope:** local only, run against `npx wrangler dev --local` on
`http://127.0.0.1:8787`. No remote/production data involved.

**Fictional demo data used:** course `SE101`; users `instructor-demo`
(instructor), `student-demo-a` and `student-demo-b` (students). None of
this is real student information.

All requests use the temporary development identity headers `x-user-id`
and `x-user-role` in place of real Student Identity token validation.

## A. Health check

```bash
curl -s -w '\nHTTP_STATUS:%{http_code}\n' http://127.0.0.1:8787/v1/health
```

## B. Create an approved source (instructor)

```bash
curl -s -X POST http://127.0.0.1:8787/v1/sources \
  -H 'x-user-id: instructor-demo' -H 'x-user-role: instructor' \
  -H 'Content-Type: application/json' \
  -d '{
    "courseId": "SE101",
    "title": "Week 3 REST API Lecture Notes",
    "sourceType": "document",
    "sourceUrl": "https://example.edu/se101/week-3-rest",
    "content": "REST is an architectural style for networked applications. REST APIs commonly use HTTP methods such as GET, POST, PATCH, and DELETE.",
    "keywords": ["REST", "API", "HTTP", "GET", "POST"],
    "status": "approved"
  }'
```

## C. Draft source is excluded from listing

```bash
curl -s -X POST http://127.0.0.1:8787/v1/sources \
  -H 'x-user-id: instructor-demo' -H 'x-user-role: instructor' \
  -H 'Content-Type: application/json' \
  -d '{
    "courseId": "SE101",
    "title": "Draft: Week 4 Notes (not yet reviewed)",
    "sourceType": "document",
    "status": "draft"
  }'

curl -s http://127.0.0.1:8787/v1/courses/SE101/sources \
  -H 'x-user-id: student-demo-a' -H 'x-user-role: student'
```

## D. Update the approved source

```bash
curl -s -X PATCH http://127.0.0.1:8787/v1/sources/<source-id> \
  -H 'x-user-id: instructor-demo' -H 'x-user-role: instructor' \
  -H 'Content-Type: application/json' \
  -d '{
    "title": "Week 3 REST API Lecture Notes (Revised)",
    "keywords": ["REST", "API", "HTTP", "GET", "POST", "PATCH", "DELETE"]
  }'
```

## E. Ask a matching question (student)

```bash
curl -s -X POST http://127.0.0.1:8787/v1/questions \
  -H 'x-user-id: student-demo-a' -H 'x-user-role: student' \
  -H 'Content-Type: application/json' \
  -d '{
    "courseId": "SE101",
    "questionText": "What is REST and which HTTP methods are commonly used?"
  }'
```

## F. Question ownership / authorization

```bash
# Owner (student-demo-a) -> expect 200
curl -s -o /dev/null -w 'HTTP_STATUS:%{http_code}\n' \
  http://127.0.0.1:8787/v1/questions/<question-id> \
  -H 'x-user-id: student-demo-a' -H 'x-user-role: student'

# Different student (student-demo-b) -> expect 403
curl -s http://127.0.0.1:8787/v1/questions/<question-id> \
  -H 'x-user-id: student-demo-b' -H 'x-user-role: student'

# Instructor (instructor-demo) -> expect 200
curl -s -o /dev/null -w 'HTTP_STATUS:%{http_code}\n' \
  http://127.0.0.1:8787/v1/questions/<question-id> \
  -H 'x-user-id: instructor-demo' -H 'x-user-role: instructor'
```

## G. Submit answer feedback

```bash
curl -s -X POST http://127.0.0.1:8787/v1/answers/feedback \
  -H 'x-user-id: student-demo-a' -H 'x-user-role: student' \
  -H 'Content-Type: application/json' \
  -d '{
    "answerId": "<answer-id>",
    "rating": 5,
    "comment": "The cited source was helpful."
  }'
```

## H. Ask a no-match question

```bash
curl -s -X POST http://127.0.0.1:8787/v1/questions \
  -H 'x-user-id: student-demo-a' -H 'x-user-role: student' \
  -H 'Content-Type: application/json' \
  -d '{
    "courseId": "SE101",
    "questionText": "Where can I check my exam schedule?"
  }'
```

## I. Archive the approved source, then re-list

```bash
curl -s -X DELETE http://127.0.0.1:8787/v1/sources/<source-id> \
  -H 'x-user-id: instructor-demo' -H 'x-user-role: instructor'

curl -s http://127.0.0.1:8787/v1/courses/SE101/sources \
  -H 'x-user-id: student-demo-a' -H 'x-user-role: student'
```

## J. Re-archive the same source (idempotency check)

```bash
curl -s -X DELETE http://127.0.0.1:8787/v1/sources/<source-id> \
  -H 'x-user-id: instructor-demo' -H 'x-user-role: instructor'
```
