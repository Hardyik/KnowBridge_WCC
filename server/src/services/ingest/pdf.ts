/**
 * PDF ingestion. Uses pdfjs-dist legacy build server-side.
 * Produces one piece per page so evidence links are page-anchored
 * ("Architecture.pdf — page 3", location "page:3"), per doc §3.4.
 */
export interface IngestPiece {
  idx: number;
  label: string;
  location: string;
  text: string;
  /** External link when the piece has one (GitHub issue/commit/file). */
  url?: string | null;
}

export async function pdfToPieces(buffer: Buffer): Promise<IngestPiece[]> {
  const pdfjs = (await import('pdfjs-dist/legacy/build/pdf.mjs')) as unknown as {
    getDocument: (opts: Record<string, unknown>) => {
      promise: Promise<{
        numPages: number;
        getPage: (n: number) => Promise<{ getTextContent: () => Promise<{ items: Array<{ str?: string }> }> }>;
      }>;
    };
  };

  const doc = await pdfjs.getDocument({
    data: new Uint8Array(buffer),
    useSystemFonts: true,
    verbosity: 0,
  }).promise;

  const pieces: IngestPiece[] = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const content = await page.getTextContent();
    const text = content.items
      .map((it) => (typeof it.str === 'string' ? it.str : ''))
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (text.length > 0) {
      pieces.push({
        idx: p - 1,
        label: `page ${p}`,
        location: `page:${p}`,
        text,
      });
    }
  }
  return pieces;
}
