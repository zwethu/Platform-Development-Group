// Reads an instructor's PDF / PowerPoint / Word file in the browser and returns
// its text split into segments, one per PDF page, slide, or document section:
//   [{ location: 'Slide 3', text: '…' }, …]
//
// Only that text is sent to the Learning Assistant API; the file itself is
// never uploaded or stored. Libraries are hosted on this origin (public/vendor)
// and loaded only when an instructor picks a file:
//   - pdf.js 4.10.38 (Apache-2.0)   public/vendor/pdfjs
//   - JSZip 3.10.1  (MIT)           public/vendor/jszip — PPTX and DOCX are zip files of XML
// XML is parsed with DOMParser as data; nothing from the file is ever executed
// or inserted into the page as HTML.
'use strict'

window.FileExtract = (() => {
  const MAX_FILE_BYTES = 25 * 1024 * 1024
  // Keep in step with src/services/chunking.ts.
  const MAX_TEXT_CHARS = 250000
  const MAX_SEGMENTS = 1000
  const MAX_LOCATION = 100

  const NS = {
    a: 'http://schemas.openxmlformats.org/drawingml/2006/main',
    p: 'http://schemas.openxmlformats.org/presentationml/2006/main',
    r: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships',
    w: 'http://schemas.openxmlformats.org/wordprocessingml/2006/main',
    rel: 'http://schemas.openxmlformats.org/package/2006/relationships',
  }

  const KINDS = {
    pdf: { label: 'PDF', unit: 'page', sourceType: 'document' },
    pptx: { label: 'PowerPoint', unit: 'slide', sourceType: 'slides' },
    docx: { label: 'Word', unit: 'section', sourceType: 'document' },
  }
  const ACCEPT = '.pdf,.pptx,.docx,application/pdf,application/vnd.openxmlformats-officedocument.presentationml.presentation,application/vnd.openxmlformats-officedocument.wordprocessingml.document'

  class ExtractError extends Error {}

  /* ---------- library loading (once, on first use) ---------- */

  let pdfjsPromise = null
  function loadPdfjs() {
    if (!pdfjsPromise) {
      pdfjsPromise = import('/vendor/pdfjs/pdf.min.js').then((lib) => {
        lib.GlobalWorkerOptions.workerSrc = '/vendor/pdfjs/pdf.worker.min.js'
        return lib
      }).catch((err) => {
        pdfjsPromise = null
        throw new ExtractError(`Could not load the PDF reader (${err.message}). Check your connection and try again.`)
      })
    }
    return pdfjsPromise
  }

  let jszipPromise = null
  function loadJszip() {
    if (!jszipPromise) {
      jszipPromise = new Promise((resolve, reject) => {
        if (window.JSZip) return resolve(window.JSZip)
        const script = document.createElement('script')
        script.src = '/vendor/jszip/jszip.min.js'
        script.onload = () => resolve(window.JSZip)
        script.onerror = () => {
          jszipPromise = null
          reject(new ExtractError('Could not load the file reader. Check your connection and try again.'))
        }
        document.head.append(script)
      })
    }
    return jszipPromise
  }

  /* ---------- helpers ---------- */

  function extensionOf(name) {
    const dot = name.lastIndexOf('.')
    return dot === -1 ? '' : name.slice(dot + 1).toLowerCase()
  }

  function parseXml(text) {
    const doc = new DOMParser().parseFromString(text, 'application/xml')
    if (doc.getElementsByTagName('parsererror').length) throw new ExtractError('The file is damaged: part of it could not be read.')
    return doc
  }

  async function zipXml(zip, path) {
    const entry = zip.file(path)
    return entry ? parseXml(await entry.async('string')) : null
  }

  /** Resolves a relationship target ("../notesSlides/n1.xml" or "/ppt/slides/s1.xml") against the part's folder. */
  function resolvePart(baseDir, target) {
    if (!target) return null
    const parts = (target.startsWith('/') ? target.slice(1) : baseDir + target).split('/')
    const out = []
    for (const part of parts) {
      if (part === '..') out.pop()
      else if (part !== '.' && part !== '') out.push(part)
    }
    return out.join('/')
  }

  /** Relationship id → { target, type } for one .rels part. */
  function relationships(relsDoc) {
    const map = new Map()
    if (!relsDoc) return map
    for (const rel of relsDoc.getElementsByTagNameNS(NS.rel, 'Relationship')) {
      map.set(rel.getAttribute('Id'), { target: rel.getAttribute('Target'), type: rel.getAttribute('Type') || '' })
    }
    return map
  }

  /** Text of DrawingML paragraphs (slides, notes): runs only, so slide-number fields are skipped. */
  function drawingText(doc) {
    const lines = []
    for (const p of doc.getElementsByTagNameNS(NS.a, 'p')) {
      let line = ''
      for (const node of p.getElementsByTagNameNS(NS.a, '*')) {
        if (node.localName === 't' && node.parentNode.localName === 'r') line += node.textContent
        else if (node.localName === 'br') line += '\n'
      }
      if (line.trim()) lines.push(line)
    }
    return lines.join('\n')
  }

  /* ---------- PDF ---------- */

  async function extractPdf(file, onProgress) {
    const pdfjs = await loadPdfjs()
    let doc
    try {
      doc = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()), isEvalSupported: false }).promise
    } catch (err) {
      if (err && err.name === 'PasswordException') throw new ExtractError('This PDF is password-protected. Save a copy without a password and upload that.')
      throw new ExtractError('This PDF could not be read. It may be damaged.')
    }
    try {
      if (doc.numPages > MAX_SEGMENTS) throw new ExtractError(`This PDF has ${doc.numPages} pages; the limit is ${MAX_SEGMENTS}. Split it into smaller files.`)
      const segments = []
      for (let n = 1; n <= doc.numPages; n++) {
        const page = await doc.getPage(n)
        const content = await page.getTextContent()
        let text = ''
        for (const item of content.items) {
          if (typeof item.str !== 'string') continue
          text += item.str
          if (item.hasEOL) text += '\n'
        }
        segments.push({ location: `Page ${n}`, text })
        page.cleanup()
        if (onProgress) onProgress(n, doc.numPages)
      }
      return segments
    } finally {
      doc.destroy()
    }
  }

  /* ---------- PowerPoint (.pptx) ---------- */

  async function extractPptx(file) {
    const JSZip = await loadJszip()
    let zip
    try { zip = await JSZip.loadAsync(file) } catch { throw new ExtractError('This is not a valid .pptx file. Old .ppt files must be saved as .pptx first.') }

    const presentation = await zipXml(zip, 'ppt/presentation.xml')
    if (!presentation) throw new ExtractError('This .pptx file has no slides that can be read.')
    const presRels = relationships(await zipXml(zip, 'ppt/_rels/presentation.xml.rels'))

    // Slides in presentation order (file names do not always match the order).
    let slidePaths = [...presentation.getElementsByTagNameNS(NS.p, 'sldId')]
      .map((el) => presRels.get(el.getAttributeNS(NS.r, 'id')))
      .map((rel) => rel && resolvePart('ppt/', rel.target))
      .filter((path) => path && zip.file(path))
    if (!slidePaths.length) {
      const num = (p) => Number(p.match(/(\d+)\.xml$/)[1])
      slidePaths = Object.keys(zip.files).filter((p) => /^ppt\/slides\/slide\d+\.xml$/.test(p)).sort((a, b) => num(a) - num(b))
    }

    const segments = []
    for (const [i, path] of slidePaths.entries()) {
      const slide = await zipXml(zip, path)
      let text = slide ? drawingText(slide) : ''

      // Speaker notes, linked from the slide's own relationships.
      const dir = path.slice(0, path.lastIndexOf('/') + 1)
      const slideRels = relationships(await zipXml(zip, `${dir}_rels/${path.slice(dir.length)}.rels`))
      const notesRel = [...slideRels.values()].find((rel) => rel.type.endsWith('/notesSlide'))
      const notesDoc = notesRel ? await zipXml(zip, resolvePart(dir, notesRel.target)) : null
      const notes = notesDoc ? drawingText(notesDoc).trim() : ''
      if (notes) text += `\n\nSpeaker notes:\n${notes}`

      segments.push({ location: `Slide ${i + 1}`, text })
    }
    return segments
  }

  /* ---------- Word (.docx) ---------- */

  /** True inside <mc:Fallback>: Word stores text boxes twice (modern + fallback copy); read only one. */
  function insideFallback(node, stop) {
    for (let el = node.parentNode; el && el !== stop; el = el.parentNode) if (el.localName === 'Fallback') return true
    return false
  }

  function wordParagraphText(p) {
    let text = ''
    for (const node of p.getElementsByTagNameNS(NS.w, '*')) {
      if (insideFallback(node, p)) continue
      if (node.localName === 't') text += node.textContent
      else if (node.localName === 'tab') text += ' '
      else if (node.localName === 'br' || node.localName === 'cr') text += '\n'
    }
    return text
  }

  function isHeading(p) {
    const pPr = p.getElementsByTagNameNS(NS.w, 'pPr')[0]
    if (!pPr) return false
    const style = pPr.getElementsByTagNameNS(NS.w, 'pStyle')[0]
    const styleId = style ? style.getAttributeNS(NS.w, 'val') || '' : ''
    return /^(heading\s?[1-3]|title)$/i.test(styleId) || pPr.getElementsByTagNameNS(NS.w, 'outlineLvl').length > 0
  }

  async function extractDocx(file) {
    const JSZip = await loadJszip()
    let zip
    try { zip = await JSZip.loadAsync(file) } catch { throw new ExtractError('This is not a valid .docx file. Old .doc files must be saved as .docx first.') }
    const doc = await zipXml(zip, 'word/document.xml')
    if (!doc) throw new ExtractError('This .docx file has no document text that can be read.')

    // A new section starts at each heading, so citations can name it.
    const segments = []
    let current = { location: null, lines: [] }
    const flush = () => {
      if (current.lines.length) segments.push({ location: current.location, text: current.lines.join('\n') })
    }
    for (const p of doc.getElementsByTagNameNS(NS.w, 'p')) {
      // Paragraphs nested inside another paragraph (text boxes) are read with their parent.
      let nested = false
      for (let el = p.parentNode; el; el = el.parentNode) if (el.namespaceURI === NS.w && el.localName === 'p') { nested = true; break }
      if (nested) continue
      const text = wordParagraphText(p).trim()
      if (!text) continue
      if (isHeading(p)) {
        flush()
        const heading = text.replace(/\s+/g, ' ')
        current = { location: `Section “${heading.length > 80 ? `${heading.slice(0, 79)}…` : heading}”`, lines: [text] }
      } else {
        current.lines.push(text)
      }
    }
    flush()
    return segments
  }

  /* ---------- public API ---------- */

  /**
   * Returns { fileName, kind, unit, sourceType, segments, stats }. Throws
   * ExtractError with a message meant for the instructor when the file
   * cannot be used.
   */
  async function extract(file, onProgress) {
    const ext = extensionOf(file.name)
    const kind = KINDS[ext]
    if (!kind) {
      if (ext === 'ppt' || ext === 'doc') throw new ExtractError(`Old .${ext} files are not supported. Open it and “Save as” .${ext}x, then upload that.`)
      throw new ExtractError('Choose a PDF (.pdf), PowerPoint (.pptx) or Word (.docx) file.')
    }
    if (file.size > MAX_FILE_BYTES) throw new ExtractError(`This file is ${(file.size / 1048576).toFixed(1)} MB; the limit is 25 MB.`)

    const raw = ext === 'pdf' ? await extractPdf(file, onProgress) : ext === 'pptx' ? await extractPptx(file) : await extractDocx(file)
    const segments = raw.map((s) => ({
      location: s.location ? s.location.slice(0, MAX_LOCATION) : null,
      text: s.text.replace(/[ \t]+\n/g, '\n').trim(),
    }))

    const chars = segments.reduce((sum, s) => sum + s.text.length, 0)
    const withText = segments.filter((s) => s.text.length > 0).length
    const words = segments.reduce((sum, s) => sum + (s.text.match(/\S+/g) || []).length, 0)

    if (withText === 0) {
      throw new ExtractError(ext === 'pdf'
        ? 'No text was found in this PDF. It is probably scanned (pictures of pages), which cannot be searched. Upload a PDF exported from the original document instead.'
        : 'No text was found in this file. Slides that contain only pictures cannot be searched.')
    }
    if (segments.length > MAX_SEGMENTS) throw new ExtractError(`This file has ${segments.length} ${kind.unit}s; the limit is ${MAX_SEGMENTS}. Split it into smaller files.`)
    if (chars > MAX_TEXT_CHARS) throw new ExtractError(`This file has ${chars.toLocaleString()} characters of text; the limit is ${MAX_TEXT_CHARS.toLocaleString()}. Split it into smaller files.`)

    return {
      fileName: file.name,
      kind: ext,
      label: kind.label,
      unit: kind.unit,
      sourceType: kind.sourceType,
      segments,
      stats: { segments: segments.length, withText, empty: segments.length - withText, words, chars },
    }
  }

  return { extract, ExtractError, ACCEPT }
})()
