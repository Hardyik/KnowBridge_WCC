/**
 * DOCX ingestion. Mammoth gives us HTML; h1/h2 become markdown headings and
 * paragraphs become blocks, then the shared heading-aware chunker splits it
 * into section-anchored pieces so evidence can point at
 * "status.docx — Rollout status".
 */
import * as mammoth from 'mammoth';
import { IngestPiece } from './pdf.js';
import { textToPieces } from './text.js';

export async function docxToPieces(buffer: Buffer): Promise<IngestPiece[]> {
  const { value: html } = await mammoth.convertToHtml({ buffer });
  return textToPieces(htmlToMarkdown(html), 'md');
}

function htmlToMarkdown(html: string): string {
  return html
    .replace(/<h1[^>]*>([\s\S]*?)<\/h1>/gi, '\n# $1\n')
    .replace(/<h2[^>]*>([\s\S]*?)<\/h2>/gi, '\n## $1\n')
    .replace(/<\/(p|li|tr|div|blockquote)>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}
