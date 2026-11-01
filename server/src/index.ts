import express from 'express';
import cors from 'cors';
import { Request, Response, NextFunction } from 'express';
import { config, serverConfigured } from './config.js';
import projectsRouter from './routes/projects.js';
import sourcesRouter from './routes/sources.js';
import extractionRouter from './routes/extraction.js';
import handoverRouter from './routes/handover.js';
import auditRouter from './routes/audit.js';

const app = express();
app.use(cors({ origin: config.corsOrigin, credentials: false }));
app.use(express.json({ limit: '2mb' }));

app.get('/healthz', (_req: Request, res: Response) => {
  res.json({
    ok: true,
    service: 'knowbridge-api',
    supabase_configured: serverConfigured(),
    groq_configured: Boolean(config.groqApiKey),
  });
});

app.use('/api', auditRouter);
app.use('/api', projectsRouter);
app.use('/api', sourcesRouter);
app.use('/api', extractionRouter);
app.use('/api', handoverRouter);

// 404 + error handling
app.use((_req: Request, res: Response) => res.status(404).json({ error: 'Not found' }));
app.use((err: Error & { status?: number }, _req: Request, res: Response, _next: NextFunction) => {
  const status = err.status ?? 500;
  console.error(`[kb-api] ${status}`, err.message);
  res.status(status).json({ error: err.message || 'Internal error' });
});

app.listen(config.port, () => {
  console.log(`KnowBridge API listening on :${config.port}`);
  console.log(`  supabase: ${serverConfigured() ? 'configured' : 'NOT configured'}`);
  console.log(`  groq:     ${config.groqApiKey ? 'configured' : 'NOT configured'}`);
});
