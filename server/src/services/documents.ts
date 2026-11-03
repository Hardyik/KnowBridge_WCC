import mammoth from 'mammoth';
import { HttpError } from '../auth.js';

export interface TextChunk {
  heading: string;
  text: string;
}

const MAX_CHUNK_CHARS = 1500;

/** Normalise text for matching quotes back to their source. */
export function normalise(input: string): string {
  return input.toLowerCase().replace(/\s+/g, ' ').trim();
}

export function supportedExtension(filename: string): boolean {
  return /\.(pdf|docx|txt|md|markdown)$/i.test(filename);
}

/** Pull plain text out of a PDF, DOCX or plain-text document. */
export async function extractText(buffer: Buffer, filename: string): Promise<string> {
  const ext = filename.toLowerCase().split('.').pop() ?? '';
  try {
    if (ext === 'pdf') {
      return await extractPdf(buffer);
    }
    if (ext === 'docx') {
      const result = await mammoth.extractRawText({ buffer });
      return result.value;
    }
    if (ext === 'txt' || ext === 'md' || ext === 'markdown') {
      return buffer.toString('utf8').replace(/^\uFEFF/, '');
    }
  } catch (err) {
    throw new HttpError(422, `Could not read ${filename}: ${(err as Error).message}`);
  }
  throw new HttpError(415, `Unsupported file type: ${filename}. Use PDF, DOCX, TXT or MD.`);
}

/**
 * Split a document into readable chunks, keeping the nearest heading so every
 * claim can say where in the document it came from.
 */
export function chunkDocument(text: string): TextChunk[] {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  const chunks: TextChunk[] = [];
  let heading = 'Document start';
  let buffer: string[] = [];
  let length = 0;

  const flush = () => {
    const joined = buffer.join('\n').trim();
    if (joined.length >= 40) chunks.push({ heading, text: joined });
    buffer = [];
    length = 0;
  };

  for (const rawLine of lines) {
    const line = rawLine.trimEnd();
    const trimmed = line.trim();

    if (looksLikeHeading(trimmed)) {
      flush();
      heading = cleanHeading(trimmed);
      continue;
    }
    if (!trimmed) {
      if (buffer.length) buffer.push('');
      continue;
    }
    buffer.push(line);
    length += line.length + 1;
    if (length >= MAX_CHUNK_CHARS) flush();
  }
  flush();

  return chunks.filter((c) => c.text.replace(/\s/g, '').length > 0);
}

/**
 * Modern PDFs use cross-reference streams that pdf-parse's bundled pdf.js
 * (1.10) cannot read, so text extraction uses the maintained pdfjs-dist.
 */
async function extractPdf(buffer: Buffer): Promise<string> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const document = await pdfjs.getDocument({
    data: new Uint8Array(buffer),
    isEvalSupported: false,
    useSystemFonts: true,
  }).promise;

  try {
    const pages: string[] = [];
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
      const page = await document.getPage(pageNumber);
      const content = await page.getTextContent();
      pages.push(
        content.items
          .map((item) => ('str' in item ? item.str : ' '))
          .join(' ')
          .replace(/\s+/g, ' '),
      );
      page.cleanup();
    }
    return pages.join('\n\n');
  } finally {
    await document.destroy();
  }
}

function looksLikeHeading(line: string): boolean {
  if (!line || line.length > 90) return false;
  if (/^#{1,6}\s+\S/.test(line)) return true;
  if (/^\d+(\.\d+)*\s+[A-Z][\w ,&/-]{2,}$/.test(line)) return true;
  if (/^[A-Z][A-Z0-9 ,&/'-]{5,}$/.test(line) && line === line.toUpperCase()) return true;
  return false;
}

function cleanHeading(line: string): string {
  const withoutHash = line.replace(/^#{1,6}\s*/, '');
  return withoutHash.replace(/:$/, '').trim().slice(0, 80);
}
