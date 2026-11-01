/**
 * Plain-text / Markdown ingestion: chunk on headings (when present) and on
 * oversized paragraph runs so evidence anchors to meaningful units.
 */
import { IngestPiece } from './pdf.js';

const MAX_PIECE_CHARS = 6000;

export function textToPieces(raw: string, ext: string): IngestPiece[] {
  const normalized = raw.replace(/\r\n/g, '\n').trim();
  if (!normalized) return [];

  const inMd = ext === 'md' || ext === 'markdown' || ext === 'mdown';
  const lines = normalized.split('\n');
  const pieces: IngestPiece[] = [];
  let idx = 0;
  let seq = 0;
  let currentLabel = `section ${++seq}`;
  let currentBuf: string[] = [];

  const push = () => {
    const text = currentBuf.join('\n').trim();
    if (text) {
      pieces.push({ idx: idx++, label: currentLabel, location: `section:${idx}`, text });
    }
    currentBuf = [];
  };

  for (const line of lines) {
    const mdHeading = inMd ? /^(#{1,4})\s+(.*)$/.exec(line) : null;
    const title = mdHeading?.[2]?.trim();
    if (title && title.length > 0 && title.length < 80) {
      push();
      currentLabel = title;
      continue;
    }
    currentBuf.push(line);
    if (currentBuf.join('\n').length > MAX_PIECE_CHARS) {
      push();
      currentLabel = `section ${++seq}`;
    }
  }
  push();
  return pieces;
}
