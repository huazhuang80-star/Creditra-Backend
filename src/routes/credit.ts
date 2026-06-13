/**
 * Credit-line routes mounted at `/api/credit` by `src/index.ts`.
 *
 * Surface (see `docs/API.md` for full request/response shapes):
 * - GET    `/lines`                            — list (public)
 * - GET    `/lines/:id`                        — fetch (public)
 * - POST   `/lines`                            — create (validated body)
 * - PUT    `/lines/:id`                        — patch
 * - DELETE `/lines/:id`                        — delete
 * - GET    `/wallet/:walletAddress/lines`      — by wallet (validated path)
 * - GET    `/lines/:id/transactions`           — history with filters & paging
 * - POST   `/lines/:id/draw`                   — draw (validated body)
 * - POST   `/lines/:id/repay`                  — repay (validated body)
 * - POST   `/lines/:id/suspend`                — admin-auth state transition
 * - POST   `/lines/:id/close`                  — admin-auth state transition
 *
 * Domain errors are mapped to HTTP status by {@link handleServiceError}:
 * - {@link CreditLineNotFoundError} → 404
 * - {@link InvalidTransitionError}  → 409
 * - anything else                   → 500
 *
 * Successful responses use the shared envelope helpers `ok()` / `fail()`
 * from `src/utils/response.ts` so every body looks like `{ data, error }`.
 */
import { Router, type Request, type Response } from 'express';
import { validateBody } from '../middleware/validate.js';
import {
  createCreditLineSchema,
  drawSchema,
  repaySchema,
} from '../schemas/index.js';
import type { DrawBody, RepayBody } from '../schemas/index.js';
import { Container } from '../container/Container.js';
import { adminAuth } from '../middleware/adminAuth.js';
import { ok, fail } from '../utils/response.js';
import {
  CreditLineNotFoundError,
  InvalidTransitionError,
  TransactionType,
  listCreditLines,
  getCreditLine,
  suspendCreditLine,
  closeCreditLine,
  getTransactions,
  submitDrawRequest,
  submitRepayRequest,
} from '../services/creditService.js';

export const creditRouter = Router();
const container = Container.getInstance();

const VALID_TRANSACTION_TYPES = Object.values(TransactionType);

function handleServiceError(err: unknown, res: Response): void {
  if (err instanceof CreditLineNotFoundError) {
    fail(res, err.message, 404);
    return;
  }
  if (err instanceof InvalidTransitionError) {
    fail(res, err.message, 409);
    return;
  }
  const message = err instanceof Error ? err.message : 'Internal server error';
  res.status(500).json({ error: message });
}

creditRouter.get('/lines', (_req, res) => {
  return ok(res, listCreditLines());
});

creditRouter.get('/lines/:id', (req, res) => {
  const line = getCreditLine(req.params.id);
  if (!line) {
    return fail(res, `Credit line "${req.params.id}" not found.`, 404);
  }
  return ok(res, line);
});

creditRouter.post('/lines', validateBody(createCreditLineSchema), async (req, res) => {
  try {
    const { walletAddress, requestedLimit } = req.body ?? {};
    const creditLine = await container.creditLineService.createCreditLine({
      walletAddress,
      creditLimit: finalLimit,
      interestRateBps: interestRateBps ?? 0,
    });
    return res.status(201).json(creditLine);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to create credit line';
    return res.status(400).json({ error: message });
  }
});

creditRouter.put('/lines/:id', async (req, res) => {
  try {
    const { creditLimit, interestRateBps, status } = req.body;
    const creditLine = await container.creditLineService.updateCreditLine(req.params.id, {
      creditLimit,
      interestRateBps,
      status,
    });
    if (!creditLine) {
      return fail(res, 'Credit line not found', 404);
    }
    return res.json(creditLine);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to update credit line';
    return res.status(400).json({ error: message });
  }
});

creditRouter.delete('/lines/:id', async (req, res) => {
  try {
    const deleted = await container.creditLineService.deleteCreditLine(req.params.id);
    if (!deleted) {
      return fail(res, 'Credit line not found', 404);
    }
    return res.status(204).send();
  } catch {
    return fail(res, 'Failed to delete credit line');
  }
});

creditRouter.get(
  '/wallet/:walletAddress/lines',
  validateParams(walletAddressParamSchema),
  async (req, res) => {
  try {
    const lines = await container.creditLineService.getCreditLinesByWallet(
      req.params.walletAddress,
    );
    res.json({ creditLines: lines });
  } catch {
    res.status(500).json({ error: 'Failed to fetch credit lines for wallet' });
  }
});

creditRouter.get(
  '/lines/:id/transactions',
  async (req: Request, res: Response): Promise<void> => {
    const id = req.params.id;
    const { type, from, to, page: pageParam, limit: limitParam } = req.query;

    if (type !== undefined && !VALID_TRANSACTION_TYPES.includes(type as TransactionType)) {
      fail(res, `Invalid type filter. Must be one of: ${VALID_TRANSACTION_TYPES.join(', ')}.`, 400);
      return;
    }
    if (from !== undefined && isNaN(new Date(from as string).getTime())) {
      fail(res, "Invalid 'from' date. Must be a valid ISO 8601 date.", 400);
      return;
    }
    if (to !== undefined && isNaN(new Date(to as string).getTime())) {
      fail(res, "Invalid 'to' date. Must be a valid ISO 8601 date.", 400);
      return;
    }

    const page = pageParam !== undefined ? parseInt(pageParam as string, 10) : 1;
    const limit = limitParam !== undefined ? parseInt(limitParam as string, 10) : 20;

    if (isNaN(page) || page < 1) {
      fail(res, "Invalid 'page'. Must be a positive integer.", 400);
      return;
    }
    if (isNaN(limit) || limit < 1 || limit > 100) {
      fail(res, "Invalid 'limit'. Must be between 1 and 100.", 400);
      return;
    }

    try {
      const result = getTransactions(
        id,
        { type: type as TransactionType | undefined, from: from as string | undefined, to: to as string | undefined },
        { page, limit },
      );
      ok(res, result);
    } catch (err) {
      handleServiceError(err, res);
    }
  },
);

creditRouter.post(
  '/lines/:id/suspend',
  adminAuth,
  (req: Request, res: Response): void => {
    try {
      const line = suspendCreditLine(req.params.id);
      res.status(200).json({ data: line, message: 'Credit line suspended.', error: null });
    } catch (err) {
      handleServiceError(err, req, res, next);
    }
  },
);

creditRouter.post(
  '/lines/:id/close',
  adminAuth,
  (req: Request, res: Response): void => {
    try {
      const line = closeCreditLine(req.params.id);
      res.status(200).json({ data: line, message: 'Credit line closed.', error: null });
    } catch (err) {
      handleServiceError(err, req, res, next);
    }
  },
);

creditRouter.post('/lines/:id/draw', validateBody(drawSchema), async (req, res, next) => {
  try {
    const result = await submitDrawRequest(req.params.id, req.body as DrawBody);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

creditRouter.post('/lines/:id/repay', validateBody(repaySchema), async (req, res, next) => {
  try {
    const result = await submitRepayRequest(req.params.id, req.body as RepayBody);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

export default creditRouter;
