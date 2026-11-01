/**
 * DOCX ingestion. Preserves top-level structure: each ".." style heading
 * starts a new piece so evidence can anchor to sections of the document.
 */
import * as mammoth from 'mammoth';
import { IngestPiece } from './pdf.js';

export async function docxToPieces(buffer: Buffer): Promise<IngestPiece[]> {
  const { value: html } = await mammoth.convertToHtml({ buffer });
  // Split into sections on h1/h2 headings.
  const blocks = html.split(/(?=<(h1|h2)\b)/i);
  const pieces: IngestPiece[] = [];
  let idx = 0;
  let currentLabel = 'section 1';
  let currentBuf: string[] = [];
  let headings = 0;

  for (const block of blocks) {
    const isHeading = /^<(h1|h2)\b/i.test(block);
    const title = isHeading ? stripTags(block).slice(0, 80) : null;
    if (isHeading && currentBuf.some((b) => b.trim())) {
      const text = stripTags(currentBuf.join(' ')).replace(/\s+/g, ' ').trim();
      if (text) {
        pieces.push({
          idx: idx++,
          label: `${currentLabel} — ${truncate(currentLabel === 'section 1' ? 'introduction' : title ?? currentLabel)}`,
          location: `section:${headings}`,
          text,
        });
      }
    }
    if (isHeading) {
      headings += 1;
      currentLabel = title ? truncate(title) : `section ${headings}`;
      currentBuf = [];
    }
    currentBuf.push(isHeading && title ? '' : stripTags(block));
  }
  const tail = stripTags(currentBuf.join(' ')).replace(/\s+/g, ' ').trim();
  if (tail) {
    pieces.push({ idx: idx++, label: currentLabel, location: `section:${headings}`, text: tail });
  }
  if (pieces.length === 0) {
    const all = stripTags(html).replace(/\s+/g, ' ').trim();
    if (all) pieces.push({ idx: 0, label: 'document', location: 'section:0', text: all });
  }
  for (let i = 0; i < pieces.length; i++) {
    if (!pieces[i].label) pieces[i].label = `section ${i + 1}`;
  }
  return pieces;
}

function stripTags(html: string): string {
  return html
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .trim();
}

function truncate(s: string, n = 60): string {
  return s.length <= n ? s : `${s.slice(0, n - 1)}…`;
}
