import { Router } from 'express';
import multer from 'multer';
import { z } from 'zod';
import {
  CONFIDENTIALITY_TIERS,
  Confidentiality,
  ProjectSource,
  SourceKind,
  SourceStatus,
} from '@knowbridge/shared';
import { asyncHandler, audit, HttpError, MemberRequest, requireMember } from '../auth.js';
import { serviceClient, Tables } from '../db.js';
import { chunkDocument, extractText, supportedExtension } from '../services/documents.js';
import { runExtraction } from '../services/extraction.js';
import { fetchGithubSources } from '../services/github.js';

const router = Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024, files: 10 },
});

const githubBody = z.object({
  repo: z.string().min(3).max(200),
  confidentiality: z.enum(CONFIDENTIALITY_TIERS).default('internal'),
});

const patchSource = z.object({
  confidentiality: z.enum(CONFIDENTIALITY_TIERS),
});

function tierFrom(value: unknown): Confidentiality {
  return CONFIDENTIALITY_TIERS.includes(value as Confidentiality) ? (value as Confidentiality) : 'internal';
}

router.get(
  '/projects/:projectId/sources',
  requireMember(),
  asyncHandler(async (req, res) => {
    const { projectId } = req as MemberRequest;
    const db = serviceClient();

    const { data: sources, error } = await db
      .from(Tables.sources)
      .select('*')
      .eq('project_id', projectId)
      .order('created_at', { ascending: true });
    if (error) throw new HttpError(500, error.message);

    const ids = (sources ?? []).map((s) => s.id as string);
    const { data: chunks } = ids.length
      ? await db.from(Tables.sourceChunks).select('source_id').in('source_id', ids)
      : { data: [] as { source_id: string }[] };
    const chunkCount = new Map<string, number>();
    for (const c of chunks ?? []) {
      chunkCount.set(c.source_id, (chunkCount.get(c.source_id) ?? 0) + 1);
    }

    const out: ProjectSource[] = (sources ?? []).map((s) => ({
      id: s.id as string,
      project_id: s.project_id as string,
      title: s.title as string,
      filename: s.filename as string,
      byte_size: s.byte_size as number,
      status: s.status as SourceStatus,
      error: (s.error as string) ?? null,
      chunk_count: chunkCount.get(s.id as string) ?? 0,
      kind: ((s.kind as SourceKind) ?? 'document') as SourceKind,
      external_ref: (s.external_ref as string) ?? null,
      confidentiality: tierFrom(s.confidentiality),
      last_synced_at: (s.last_synced_at as string) ?? null,
      created_at: s.created_at as string,
    }));
    res.json({ sources: out });
  }),
);

router.post(
  '/projects/:projectId/sources',
  requireMember('projectId', ['manager', 'reviewer']),
  upload.array('files', 10),
  asyncHandler(async (req, res) => {
    const { projectId, profile } = req as MemberRequest;
    const files = (req.files ?? []) as Express.Multer.File[];
    if (!files.length) throw new HttpError(400, 'No files were uploaded');

    const confidentiality = tierFrom((req.body as Record<string, unknown>)?.confidentiality);
    const db = serviceClient();
    const sources = [];
    const errors: { filename: string; error: string }[] = [];

    for (const file of files) {
      const originalName = Buffer.from(file.originalname, 'latin1').toString('utf8');
      const title = originalName.replace(/\.[^.]+$/, '');

      if (!supportedExtension(originalName)) {
        errors.push({ filename: originalName, error: 'Unsupported type — use PDF, DOCX, TXT or MD' });
        continue;
      }

      const { data: source, error: insertError } = await db
        .from(Tables.sources)
        .insert({
          project_id: projectId,
          title,
          filename: originalName,
          byte_size: file.size,
          status: 'ready',
          uploaded_by: profile.id,
          kind: 'document',
          confidentiality,
        })
        .select('*')
        .single();
      if (insertError || !source) {
        errors.push({ filename: originalName, error: insertError?.message ?? 'Insert failed' });
        continue;
      }

      try {
        const text = await extractText(file.buffer, originalName);
        const chunks = chunkDocument(text);
        if (!chunks.length) throw new Error('No readable text found in this document');

        const { error: chunkError } = await db.from(Tables.sourceChunks).insert(
          chunks.map((chunk, index) => ({
            source_id: source.id,
            ordinal: index,
            heading: chunk.heading,
            text: chunk.text,
          })),
        );
        if (chunkError) throw new Error(chunkError.message);

        sources.push({ ...source, chunk_count: chunks.length });
        await audit(projectId, profile.id, 'source.added', 'source', source.id as string, {
          filename: originalName,
          chunks: chunks.length,
          confidentiality,
        });
      } catch (err) {
        const message = (err as Error).message;
        await db
          .from(Tables.sources)
          .update({ status: 'failed', error: message })
          .eq('id', source.id);
        errors.push({ filename: originalName, error: message });
      }
    }

    res.status(201).json({ sources, errors });
  }),
);

/**
 * Read-only repository connector. README, issues and recent commits become
 * three sources with dated passages; nothing is written back to GitHub.
 * Re-connecting the same repository replaces its previous sources.
 */
router.post(
  '/projects/:projectId/sources/github',
  requireMember('projectId', ['manager', 'reviewer']),
  asyncHandler(async (req, res) => {
    const { projectId, profile } = req as MemberRequest;
    const body = githubBody.safeParse(req.body ?? {});
    if (!body.success) throw new HttpError(400, 'Send a repository as owner/name');

    const fetched = await fetchGithubSources(body.data.repo);
    const db = serviceClient();

    const { data: previous } = await db
      .from(Tables.sources)
      .select('id')
      .eq('project_id', projectId)
      .eq('kind', 'github')
      .eq('external_ref', fetched.external_ref);
    if (previous?.length) {
      await db
        .from(Tables.sources)
        .delete()
        .in(
          'id',
          previous.map((row) => row.id as string),
        );
    }

    const created = [];
    for (const artifact of fetched.sources) {
      const characters = artifact.chunks.reduce((sum, chunk) => sum + chunk.text.length, 0);
      const { data: source, error } = await db
        .from(Tables.sources)
        .insert({
          project_id: projectId,
          title: artifact.title,
          filename: artifact.filename,
          byte_size: characters,
          status: 'ready',
          uploaded_by: profile.id,
          kind: 'github',
          external_ref: fetched.external_ref,
          confidentiality: body.data.confidentiality,
          last_synced_at: new Date().toISOString(),
        })
        .select('*')
        .single();
      if (error || !source) throw new HttpError(500, error?.message ?? 'Could not store the repository source');

      const { error: chunkError } = await db.from(Tables.sourceChunks).insert(
        artifact.chunks.map((chunk, index) => ({
          source_id: source.id,
          ordinal: index,
          heading: chunk.heading,
          text: chunk.text,
          occurred_at: chunk.occurred_at,
        })),
      );
      if (chunkError) throw new HttpError(500, chunkError.message);

      created.push({ ...source, chunk_count: artifact.chunks.length });
    }

    await audit(projectId, profile.id, 'source.github_connected', 'source', null, {
      repo: fetched.external_ref,
      sources: created.length,
      replaced: previous?.length ?? 0,
      confidentiality: body.data.confidentiality,
    });

    res.status(201).json({
      repo: fetched.external_ref,
      sources: created,
      notes: fetched.notes,
      replaced: previous?.length ?? 0,
    });
  }),
);

router.patch(
  '/projects/:projectId/sources/:sourceId',
  requireMember('projectId', ['manager']),
  asyncHandler(async (req, res) => {
    const { projectId, profile } = req as MemberRequest;
    const body = patchSource.safeParse(req.body ?? {});
    if (!body.success) throw new HttpError(400, 'Choose public, internal or restricted');

    const db = serviceClient();
    const { data: updated, error } = await db
      .from(Tables.sources)
      .update({ confidentiality: body.data.confidentiality })
      .eq('id', req.params.sourceId)
      .eq('project_id', projectId)
      .select('id, confidentiality')
      .single();
    if (error) throw new HttpError(500, error.message);

    // Claims read their tier from the source, so a change here applies to every
    // live view at once. Approved snapshots keep the tier they were approved
    // with.
    await audit(projectId, profile.id, 'source.confidentiality_changed', 'source', String(req.params.sourceId), {
      confidentiality: body.data.confidentiality,
    });
    res.json({ source: updated });
  }),
);

router.delete(
  '/projects/:projectId/sources/:sourceId',
  requireMember('projectId', ['manager']),
  asyncHandler(async (req, res) => {
    const { projectId, profile } = req as MemberRequest;
    const { error } = await serviceClient()
      .from(Tables.sources)
      .delete()
      .eq('id', req.params.sourceId)
      .eq('project_id', projectId);
    if (error) throw new HttpError(500, error.message);

    await audit(projectId, profile.id, 'source.removed', 'source', String(req.params.sourceId), null);
    res.json({ ok: true });
  }),
);

router.post(
  '/projects/:projectId/extract',
  requireMember('projectId', ['manager', 'reviewer']),
  asyncHandler(async (req, res) => {
    const { projectId, profile } = req as MemberRequest;
    const refresh = Boolean((req.body as { refresh?: unknown })?.refresh);
    const summary = await runExtraction(projectId, { refresh });
    await audit(projectId, profile.id, refresh ? 'extraction.refreshed' : 'extraction.run', 'project', projectId, {
      ...summary,
    });
    res.json({ summary });
  }),
);

export default router;
