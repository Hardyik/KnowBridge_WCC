/**
 * Sources: upload PDF/DOCX/TXT, connect a GitHub repo (read-only), list,
 * delete, and read pieces. Storage bucket: kb_documents (private).
 */
import { Router } from 'express';
import multer from 'multer';
import { z } from 'zod';
import { Source } from '@knowbridge/shared';
import { AuthedRequest, asyncHandler, HttpError, audit, requireMember } from '../auth.js';
import { serviceClient, Tables } from '../db.js';
import { pdfToPieces } from '../services/ingest/pdf.js';
import { docxToPieces } from '../services/ingest/docx.js';
import { textToPieces } from '../services/ingest/text.js';
import { fetchGitHubSnapshot } from '../services/github.js';

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });

const EXT_OK = new Set(['pdf', 'docx', 'txt', 'md']);

interface SourceRow {
  id: string;
  project_id: string;
  type: string;
  title: string;
  status: string;
  created_by: string;
  external_ref: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
}

const BUCKET = 'kb_documents';

async function ensureBucket() {
  const db = serviceClient();
  const { data } = await db.storage.listBuckets();
  if (!data?.some((b) => b.name === BUCKET)) {
    await db.storage.createBucket(BUCKET, { public: false }).then((r) => {
      // Already-exists races are fine.
      if (r.error && !/exists/i.test(r.error.message)) throw new Error(r.error.message);
    });
  }
}

export function rowsToSources(rows: SourceRow[] | null): Source[] {
  return (rows ?? []).map((r) => ({
    ...r,
    type: r.type as Source['type'],
    status: r.status as Source['status'],
  }));
}

// ---------------------------------------------------------------------------
// Upload documents
// ---------------------------------------------------------------------------

router.post(
  '/projects/:projectId/sources/upload',
  requireMember('projectId', ['manager', 'reviewer']),
  upload.array('files', 10),
  asyncHandler(async (req: AuthedRequest, res) => {
    const files = (req.files as Express.Multer.File[]) ?? [];
    if (files.length === 0) throw new HttpError(400, 'No files uploaded');

    await ensureBucket();
    const db = serviceClient();
    const user = req.profile!;
    const createdSources: Source[] = [];

    for (const file of files) {
      const ext = (file.originalname.split('.').pop() ?? '').toLowerCase();
      if (!EXT_OK.has(ext)) {
        throw new HttpError(415, `Unsupported file type: .${ext} (allowed: PDF, DOCX, TXT, MD)`);
      }

      const pieces =
        ext === 'pdf'
          ? await pdfToPieces(file.buffer)
          : ext === 'docx'
            ? await docxToPieces(file.buffer)
            : textToPieces(file.buffer.toString('utf8'), ext === 'md' ? 'md' : 'txt');

      if (pieces.length === 0) {
        throw new HttpError(422, `Could not extract any text from ${file.originalname}`);
      }

      const storagePath = `${req.params.projectId}/${Date.now()}-${file.originalname}`;
      const up = await db.storage.from(BUCKET).upload(storagePath, file.buffer, {
        contentType: file.mimetype,
        upsert: false,
      });
      if (up.error) throw new HttpError(500, `Storage upload failed: ${up.error.message}`);

      const { data: source, error } = await db
        .from(Tables.sources)
        .insert({
          project_id: req.params.projectId,
          type: 'document',
          title: file.originalname,
          status: 'ready',
          created_by: user.id,
          external_ref: file.originalname,
          metadata: {
            storage_path: storagePath,
            content_type: file.mimetype,
            size_bytes: file.size,
            piece_count: pieces.length,
          },
        })
        .select('*')
        .single();
      if (error) throw new HttpError(400, error.message);

      await db.from(Tables.sourcePieces).insert(
        pieces.map((p) => ({
          source_id: source.id,
          idx: p.idx,
          label: `${file.originalname} — ${p.label}`,
          location: p.location,
          text: p.text,
          url: p.url ?? null,
        })),
      );

      createdSources.push({ ...(source as SourceRow), type: 'document', status: 'ready' });
      await audit(req.params.projectId!, user, 'source.upload', {
        title: file.originalname,
        pieces: pieces.length,
      });
    }

    res.status(201).json({ sources: rowsToSources(createdSources) });
  }),
);

// ---------------------------------------------------------------------------
// Connect GitHub repo (read-only snapshot; token used at call time only)
// ---------------------------------------------------------------------------

const ConnectGithub = z.object({
  repo: z.string().regex(/^[\w.-]+\/[\w.-]+$/, 'Repo must be "owner/repo"'),
  token: z.string().max(255).optional(),
});

router.post(
  '/projects/:projectId/sources/github',
  requireMember('projectId', ['manager', 'reviewer']),
  asyncHandler(async (req: AuthedRequest, res) => {
    const projectId = req.params.projectId!;
    const body = ConnectGithub.parse(req.body);
    const user = req.profile!;

    const snapshot = await fetchGitHubSnapshot(body.repo, body.token);
    const db = serviceClient();
    const { data: source, error } = await db
      .from(Tables.sources)
      .insert({
        project_id: projectId,
        type: 'github',
        title: snapshot.title,
        status: 'ready',
        created_by: user.id,
        external_ref: body.repo,
        metadata: snapshot.metadata,
      })
      .select('*')
      .single();
    if (error) throw new HttpError(400, error.message);

    await db.from(Tables.sourcePieces).insert(
      snapshot.pieces.map((p) => ({
        source_id: source.id,
        idx: p.idx,
        label: `${snapshot.title} — ${p.label}`,
        location: p.location,
        text: p.text,
        url: p.url ?? null,
      })),
    );

    await audit(projectId, user, 'source.connect', { repo: body.repo, pieces: snapshot.pieces.length });
    res.status(201).json({
      source: { ...(source as SourceRow), type: 'github', status: 'ready' } as Source,
      pieces: snapshot.pieces.length,
    });
  }),
);

// ---------------------------------------------------------------------------
// List / pieces / delete
// ---------------------------------------------------------------------------

router.get(
  '/projects/:projectId/sources',
  requireMember('projectId'),
  asyncHandler(async (req: AuthedRequest, res) => {
    const { data } = await serviceClient()
      .from(Tables.sources)
      .select('*')
      .eq('project_id', req.params.projectId)
      .order('created_at', { ascending: true });
    res.json({ sources: rowsToSources(data as SourceRow[]) });
  }),
);

router.get(
  '/projects/:projectId/sources/:sourceId/pieces',
  requireMember('projectId'),
  asyncHandler(async (req: AuthedRequest, res) => {
    const { data } = await serviceClient()
      .from(Tables.sourcePieces)
      .select('id, source_id, idx, label, location, text, url')
      .eq('source_id', req.params.sourceId)
      .order('idx', { ascending: true });
    res.json({ pieces: data ?? [] });
  }),
);

router.delete(
  '/projects/:projectId/sources/:sourceId',
  requireMember('projectId', ['manager', 'reviewer']),
  asyncHandler(async (req: AuthedRequest, res) => {
    const db = serviceClient();
    const { data: source } = await db
      .from(Tables.sources)
      .select('*')
      .eq('id', req.params.sourceId)
      .eq('project_id', req.params.projectId)
      .single();
    if (!source) throw new HttpError(404, 'Source not found');

    // Uploaded file removal (github sources have no stored file).
    const path = (source.metadata as { storage_path?: string }).storage_path;
    if (path) {
      await db.storage.from(BUCKET).remove([path]);
    }
    await db.from(Tables.sources).delete().eq('id', source.id); // pieces cascade
    await audit(req.params.projectId!, req.profile!, 'source.delete', { source_id: source.id });
    res.json({ ok: true });
  }),
);

export default router;
