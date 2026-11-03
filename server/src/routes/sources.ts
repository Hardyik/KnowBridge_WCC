import { Router } from 'express';
import multer from 'multer';
import { ProjectSource, SourceStatus } from '@knowbridge/shared';
import { asyncHandler, audit, HttpError, MemberRequest, requireMember } from '../auth.js';
import { serviceClient, Tables } from '../db.js';
import { chunkDocument, extractText, supportedExtension } from '../services/documents.js';
import { runExtraction } from '../services/extraction.js';

const router = Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024, files: 10 },
});

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
    const summary = await runExtraction(projectId);
    await audit(projectId, profile.id, 'extraction.run', 'project', projectId, { ...summary });
    res.json({ summary });
  }),
);

export default router;
