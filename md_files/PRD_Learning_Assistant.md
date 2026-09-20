# PRD — Learning Assistant (Team 08)

## Purpose
Answer course questions from approved materials with citations and clear limits on what the assistant knows.

## Scope
Screens: question workspace, cited answer detail, instructor knowledge manager. Entities: KnowledgeSource, Question, Answer, Citation. REST: `POST /questions`, `GET /questions/{id}`, `GET /courses/{id}/sources`, `POST /sources`, `PATCH /sources/{id}`, `DELETE /sources/{id}`, `POST /answers/feedback`.

## Integrations
Consume Identity, Course Catalog, and `assignment.published` for context. Publish `learning.questioned` to Data & Analytics and optional `learning.escalated` to Helpdesk. Never expose private submissions as knowledge sources.

## AI and quality
AI retrieves approved sources and generates cited answers; fallback searches titles/keywords and returns links. Tests (minimum 7): citation, no-source response, access control, source ingest, assignment event, feedback, prompt-injection rejection.
