// Splits knowledge-source text into passages ("chunks") for search and for
// the AI prompt. Pure functions, no I/O.
//
// Uploaded files arrive as segments that the instructor's browser already
// extracted — one per PDF page, PPTX slide, or DOCX section — each with a
// location label ("Page 3", "Slide 14"). Each segment becomes one or more
// chunks of at most CHUNK_MAX_CHARS that keep that label, so a citation can
// point at the exact page or slide.

export const CHUNK_MAX_CHARS = 1000

/** Upload limits (D1: 100 bound parameters and 100 KB per statement; one batch per request). */
export const MAX_SOURCE_TEXT_CHARS = 250_000
export const MAX_SEGMENTS = 1000
export const MAX_CHUNKS_PER_SOURCE = 500
export const MAX_LOCATION_LENGTH = 100
export const MAX_FILE_NAME_LENGTH = 200
export const ALLOWED_FILE_EXTENSIONS = ['pdf', 'pptx', 'docx'] as const

export interface Segment {
  location: string | null
  text: string
}

export interface ChunkDraft {
  position: number
  location: string | null
  content: string
}

/** Collapses runs of spaces/tabs, trims each line, and keeps at most one blank line between paragraphs. */
export function normalizeText(text: string): string {
  return text
    .replace(/\r\n?/g, '\n')
    .replace(/[\t\f\v  ]+/g, ' ')
    .split('\n')
    .map((line) => line.trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/** Splits one over-long paragraph at sentence ends, or at spaces as a last resort. */
function splitLongParagraph(paragraph: string, max: number): string[] {
  const pieces: string[] = []
  let rest = paragraph
  while (rest.length > max) {
    const window = rest.slice(0, max)
    const sentenceEnd = Math.max(window.lastIndexOf('. '), window.lastIndexOf('? '), window.lastIndexOf('! '), window.lastIndexOf('\n'))
    const space = window.lastIndexOf(' ')
    const cut = sentenceEnd > max * 0.5 ? sentenceEnd + 1 : space > max * 0.5 ? space : max
    pieces.push(rest.slice(0, cut).trim())
    rest = rest.slice(cut).trim()
  }
  if (rest) pieces.push(rest)
  return pieces
}

/** Packs paragraphs into pieces of at most `max` characters, never splitting a paragraph that fits. */
export function splitIntoChunks(text: string, max = CHUNK_MAX_CHARS): string[] {
  const normalized = normalizeText(text)
  if (!normalized) return []

  const pieces: string[] = []
  let current = ''
  for (const paragraph of normalized.split('\n\n')) {
    for (const part of paragraph.length > max ? splitLongParagraph(paragraph, max) : [paragraph]) {
      if (current && current.length + 2 + part.length > max) {
        pieces.push(current)
        current = part
      } else {
        current = current ? `${current}\n\n${part}` : part
      }
    }
  }
  if (current) pieces.push(current)
  return pieces
}

/** Turns extracted segments into numbered chunks. Empty segments (e.g. a picture-only slide) are skipped. */
export function chunkSegments(segments: Segment[], max = CHUNK_MAX_CHARS): ChunkDraft[] {
  const chunks: ChunkDraft[] = []
  for (const segment of segments) {
    for (const content of splitIntoChunks(segment.text, max)) {
      chunks.push({ position: chunks.length, location: segment.location, content })
    }
  }
  return chunks
}

export function fileExtension(fileName: string): string {
  const dot = fileName.lastIndexOf('.')
  return dot === -1 ? '' : fileName.slice(dot + 1).toLowerCase()
}
