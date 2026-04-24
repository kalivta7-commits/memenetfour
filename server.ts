import 'dotenv/config';
import { logger } from './src/backend/utils/logger';

// ---------------------------------------------------------------------------
// Env validation — fatal if core vars missing
// ---------------------------------------------------------------------------

function validateEnv() {
  const required = ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY'];
  for (const key of required) {
    if (!process.env[key]) {
      logger.error(`FATAL: ${key} is missing. Cannot start.`);
      process.exit(1);
    }
  }
  if (!process.env.OPENROUTER_API_KEY)  logger.warn('OPENROUTER_API_KEY missing — AI disabled, app still runs.');
  if (!process.env.FIRECRAWL_API_KEY)   logger.warn('FIRECRAWL_API_KEY missing — news scraping disabled.');
  if (!process.env.TWITTER_BEARER_TOKEN) logger.warn('TWITTER_BEARER_TOKEN missing — X enrichment disabled.');
}

validateEnv();

import express from 'express';
import cors from 'cors';
import path from 'path';
import { createServer as createViteServer } from 'vite';

import { supabaseAdmin }  from './src/backend/utils/supabase';
import { eventEngine }    from './src/backend/services/eventEngine';
import { startScheduler } from './src/backend/scheduler';
import { getMarketData }  from './src/backend/services/dataEngine';

import tokensRouter      from './src/backend/routes/tokens';
import postsRouter       from './src/backend/routes/posts';
import adminRouter       from './src/backend/routes/admin';
import submissionsRouter from './src/backend/routes/submissions';
import eventsRouter      from './src/backend/routes/events';
import tokenOwnerRouter  from './src/backend/routes/tokenOwner';

// ---------------------------------------------------------------------------
// Server bootstrap
// ---------------------------------------------------------------------------

async function startServer() {
  const app  = express();
  const PORT = Number(process.env.PORT) || 3000;

  // ── Security & parsing ──────────────────────────────────────────────────
  app.use(cors({
    origin: process.env.NODE_ENV === 'production'
      ? [process.env.APP_URL ?? ''].filter(Boolean)
      : true,
    credentials: true,
  }));

  // JSON body (only for non-multipart routes; multer handles multipart)
  app.use((req, _res, next) => {
    if (req.is('multipart/form-data')) return next();
    express.json({ limit: '1mb' })(req, _res, next);
  });
  app.use(express.urlencoded({ extended: true, limit: '1mb' }));

  // ── API routes ──────────────────────────────────────────────────────────
  app.use('/api/tokens',      tokensRouter);
  app.use('/api/posts',       postsRouter);
  app.use('/api/feed',        postsRouter);        // ← /api/feed alias used by Feed.tsx
  app.use('/api/admin',       adminRouter);
  app.use('/api/submissions', submissionsRouter);
  app.use('/api/events',      eventsRouter);
  app.use('/api/token',       tokenOwnerRouter);   // ← token owner auth + dashboard

  // ── Cost stats endpoint ─────────────────────────────────────────────────
  app.get('/api/system/cost', (_req, res) => {
    const { costControl } = require('./src/backend/services/costControl');
    res.json(costControl.getUsage());
  });

  // ── Market overview endpoint (BTC + ETH) — used by RightPanel ──────────
  // Cached server-side via dataEngine TTL (60s) — no CORS issues
  app.get('/api/market/overview', async (_req, res) => {
    try {
      const [btc, eth] = await Promise.allSettled([
        getMarketData('bitcoin'),
        getMarketData('ethereum'),
      ]);
      res.json({
        bitcoin:  btc.status === 'fulfilled' ? btc.value  : null,
        ethereum: eth.status === 'fulfilled' ? eth.value  : null,
      });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // ── Vite dev middleware or static production serving ────────────────────
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server:  { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  // ── Supabase Realtime — auto-trigger AI on new submissions ──────────────
  logger.info('Initializing Supabase realtime listener...');
  supabaseAdmin
    .channel('pending_submissions')
    .on(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'token_submissions', filter: 'status=eq.pending' },
      (payload) => {
        logger.info(`New pending submission detected: ${(payload.new as any)?.ticker ?? 'unknown'}`);
        // The scheduler + admin approval flow handles next steps
      }
    )
    .subscribe();

  // ── Start scheduler ─────────────────────────────────────────────────────
  startScheduler();

  // ── Run first event cycle immediately on boot ───────────────────────────
  eventEngine.runCycle().catch(err =>
    logger.error('Initial event cycle error: ' + err.message)
  );

  // ── Listen ──────────────────────────────────────────────────────────────
  app.listen(PORT, () => {
    logger.info(`✅ MemeNet running on http://localhost:${PORT}`);
  });
}

startServer().catch(err => {
  logger.error('Fatal startup error: ' + err.message);
  process.exit(1);
});
