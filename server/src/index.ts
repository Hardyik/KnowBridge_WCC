import express from 'express';
import cors from 'cors';
import { config } from './config.js';
import { errorHandler, HttpError } from './auth.js';
import authRoutes from './routes/auth.js';
import projectRoutes from './routes/projects.js';
import sourceRoutes from './routes/sources.js';
import claimRoutes from './routes/claims.js';
import handoverRoutes from './routes/handovers.js';

const app = express();

app.disable('x-powered-by');
app.use(
  cors({
    origin: config.corsOrigin.split(',').map((origin) => origin.trim()),
    credentials: false,
  }),
);
app.use(express.json({ limit: '1mb' }));

app.get('/healthz', (_req, res) => {
  res.json({
    ok: true,
    service: 'knowbridge-api',
    supabase_configured: true,
    groq_configured: config.groqConfigured,
    model: config.groqModel,
  });
});

app.use('/api', authRoutes);
app.use('/api', projectRoutes);
app.use('/api', sourceRoutes);
app.use('/api', claimRoutes);
app.use('/api', handoverRoutes);

app.use((_req, _res, next) => next(new HttpError(404, 'Not found')));
app.use(errorHandler);

app.listen(config.port, () => {
  console.log(`KnowBridge API listening on :${config.port}`);
  console.log(`  model: ${config.groqModel}`);
});
