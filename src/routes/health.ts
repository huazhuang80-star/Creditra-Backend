/**
 * Health / readiness endpoint.
 *
 * `GET /health` performs two parallel dependency probes — Postgres and
 * Stellar Horizon — each with its own bounded timeout. The aggregated
 * envelope is suitable for both Kubernetes `livenessProbe` (HTTP 200) and
 * `readinessProbe` (`data.ready === true`).
 *
 * - Database probe: `SELECT 1` with a 1s timeout
 * - Horizon probe: `fetch(HORIZON_URL)` with a 2s timeout
 *
 * Dependency status vocabulary:
 * - `ok` — reachable and behaved
 * - `unconfigured` — required env var missing
 * - `degraded` — reachable but errored or timed out
 *
 * See `docs/OBSERVABILITY.md` §3 for sample manifests.
 */
import { Router } from 'express';
import { ok } from '../utils/response.js';
import { getConnection } from '../db/client.js';
import { resolveConfig } from '../services/horizonListener.js';

export const healthRouter = Router();

type DependencyState = 'ok' | 'unconfigured' | 'degraded';

interface DependencyHealth {
     status: DependencyState;
     message?: string;
}

const DB_CHECK_SQL = 'SELECT 1';
const DB_CHECK_TIMEOUT_MS = 1000;
const HORIZON_CHECK_TIMEOUT_MS = 2000;

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
     return new Promise((resolve, reject) => {
          const timer = setTimeout(() => {
               reject(new Error(`${label} check timed out after ${timeoutMs}ms`));
          }, timeoutMs);

          promise
               .then((value) => {
                    clearTimeout(timer);
                    resolve(value);
               })
               .catch((error) => {
                    clearTimeout(timer);
                    reject(error);
               });
     });
}

async function checkDatabase(): Promise<DependencyHealth> {
     const databaseUrl = process.env.DATABASE_URL;

     if (!databaseUrl) {
          return { status: 'unconfigured', message: 'DATABASE_URL is not set' };
     }

     let client;
     try {
          client = getConnection();
          if (client.connect) {
               await withTimeout(client.connect(), DB_CHECK_TIMEOUT_MS, 'Database connect');
          }
          await withTimeout(client.query(DB_CHECK_SQL), DB_CHECK_TIMEOUT_MS, 'Database query');
          return { status: 'ok' };
     } catch (error: unknown) {
          return {
               status: 'degraded',
               message: error instanceof Error ? error.message : 'unknown database error',
          };
     } finally {
          try {
               if (client && typeof client.end === 'function') {
                    await client.end();
               }
          } catch {
               // ignore shutdown errors
          }
     }
}

async function checkHorizon(): Promise<DependencyHealth> {
     const horizonUrl = resolveConfig().horizonUrl;

     try {
          const controller = new AbortController();
          const timeout = setTimeout(() => controller.abort(), HORIZON_CHECK_TIMEOUT_MS);
          const response = await fetch(horizonUrl, { signal: controller.signal });
          clearTimeout(timeout);

          if (!response.ok) {
               return { status: 'degraded', message: `Horizon returned HTTP ${response.status}` };
          }

          return { status: 'ok' };
     } catch (error: unknown) {
          const message =
               error instanceof Error && (error.name === 'AbortError' || error.message.includes('timed out'))
                    ? `Horizon check timed out (${HORIZON_CHECK_TIMEOUT_MS}ms)`
                    : error instanceof Error
                         ? error.message
                         : 'unknown horizon error';

          return { status: 'degraded', message };
     }
}

healthRouter.get('/', async (_req, res) => {
     const [dbStatus, horizonStatus] = await Promise.all([checkDatabase(), checkHorizon()]);
     const ready = dbStatus.status === 'ok' && horizonStatus.status === 'ok';

     ok(res, {
          status: 'ok',
          service: 'creditra-backend',
          ready,
          dependencies: {
               database: dbStatus,
               horizon: horizonStatus,
          },
     });
});