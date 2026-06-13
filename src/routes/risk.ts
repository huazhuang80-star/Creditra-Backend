/**
 * Risk-evaluation routes mounted at `/api/risk` by `src/index.ts`.
 *
 * Surface (see `docs/API.md` and `docs/SIGNALS_INGEST.md` for the pipeline):
 * - POST `/evaluate`                          — body validated; returns
 *   the cached evaluation when fresh (<24h) unless `forceRefresh: true`.
 * - GET  `/evaluations/:id`                   — fetch by id (404 if missing).
 * - GET  `/wallet/:walletAddress/latest`      — most recent for wallet.
 * - GET  `/wallet/:walletAddress/history`     — paginated history.
 * - POST `/admin/recalibrate`                 — protected by `X-API-Key`.
 *
 * Wallet path params are validated against the Stellar pubkey regex via
 * `walletAddressParamSchema`. The provider behind these routes is
 * pluggable — see `RISK_PROVIDER` and `src/services/providers/`.
 */
import { Router, type Request, type Response } from 'express';
import { createApiKeyMiddleware } from '../middleware/auth.js';
import { loadApiKeys } from '../config/apiKeys.js';
import { validateBody, validateQuery, validateParams } from '../middleware/validate.js';
import { ok, fail } from '../utils/response.js';
import { Container } from '../container/Container.js';
import {
  riskEvaluateSchema,
  riskHistoryQuerySchema,
  walletAddressParamSchema,
  type RiskEvaluateBody,
  type RiskHistoryQuery,
} from '../schemas/index.js';

export const riskRouter = Router();
const container = Container.getInstance();
const requireApiKey = createApiKeyMiddleware(() => loadApiKeys());

riskRouter.post(
  '/evaluate',
  validateBody(riskEvaluateSchema),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const { walletAddress, forceRefresh } = req.body as RiskEvaluateBody;
      const result = await container.riskEvaluationService.evaluateRisk({
        walletAddress,
        forceRefresh,
      });

      ok(res, result);
    } catch (error) {
      fail(res, error, 500);
    }
  },
);

riskRouter.get('/evaluations/:id', async (req: Request, res: Response): Promise<void> => {
  try {
    const evaluation = await container.riskEvaluationService.getRiskEvaluation(req.params.id);

    if (!evaluation) {
      fail(res, 'Risk evaluation not found', 404);
      return;
    }

    ok(res, evaluation);
  } catch {
    fail(res, 'Failed to fetch risk evaluation', 500);
  }
});

riskRouter.get(
  '/wallet/:walletAddress/latest',
  validateParams(walletAddressParamSchema),
  async (req: Request, res: Response): Promise<void> => {
  try {
    const evaluation = await container.riskEvaluationService.getLatestRiskEvaluation(req.params.walletAddress);

    if (!evaluation) {
      fail(res, 'No risk evaluation found for wallet', 404);
      return;
    }

    ok(res, evaluation);
  } catch {
    fail(res, 'Failed to fetch latest risk evaluation', 500);
  }
});

riskRouter.get(
  '/wallet/:walletAddress/history',
  validateParams(walletAddressParamSchema),
  validateQuery(riskHistoryQuerySchema),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const { offset, limit } = req.query as unknown as RiskHistoryQuery;
      const evaluations = await container.riskEvaluationService.getRiskEvaluationHistory(
        req.params.walletAddress,
        offset,
        limit,
      );

      ok(res, { evaluations });
    } catch {
      fail(res, 'Failed to fetch risk evaluation history', 500);
    }
  },
);

riskRouter.post('/admin/recalibrate', requireApiKey, (_req: Request, res: Response): void => {
  ok(res, { message: 'Risk model recalibration triggered' });
});

export default riskRouter;
