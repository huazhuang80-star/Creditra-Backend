/**
 * Outbound-webhook management routes mounted at `/api/webhooks`.
 *
 * These endpoints describe the **server's** outbound webhook fan-out (the
 * draw-confirmation push). The backend does not currently receive any
 * inbound webhooks.
 *
 * Surface:
 * - GET  `/config`      — sanitized config (URLs + retry knobs; secret
 *   never returned).
 * - POST `/test`        — sends a connectivity probe to every configured
 *   URL and returns a `{ reachable, unreachable, results[] }` summary.
 * - GET  `/health`      — `active` / `disabled` state, used by dashboards.
 *
 * Outbound payload contract (subscriber side) is documented in
 * `docs/API.md` §Webhooks: HMAC-SHA256 over the raw body, signed with
 * `WEBHOOK_SECRET`, delivered as `X-Webhook-Signature: sha256=…`.
 */
import { Router, type Request, type Response } from 'express';
import { getWebhookConfig, testWebhookConnectivity } from '../services/drawWebhookService.js';
import { redactLogArgs } from '../utils/logRedact.js';

export const webhookRouter = Router();

/**
 * Get current webhook configuration
 */
webhookRouter.get('/config', (_req: Request, res: Response) => {
    const config = getWebhookConfig();
    
    if (!config) {
        return res.status(200).json({
            urls: [],
            configured: false,
            message: 'Webhooks not configured'
        });
    }

    // Return config without sensitive data
    const safeConfig = {
        urls: config.urls,
        maxRetries: config.maxRetries,
        initialBackoffMs: config.initialBackoffMs,
        backoffMultiplier: config.backoffMultiplier,
        timeoutMs: config.timeoutMs,
        configured: config.urls.length > 0
    };

    return res.status(200).json(safeConfig);
});

/**
 * Test webhook connectivity
 */
webhookRouter.post('/test', async (_req: Request, res: Response) => {
    try {
        const results = await testWebhookConnectivity();
        
        const summary = {
            total: results.length,
            reachable: results.filter(r => r.reachable).length,
            unreachable: results.filter(r => !r.reachable).length,
            results
        };

        res.status(200).json(summary);
    } catch (error) {
        console.error(...redactLogArgs(['[WebhookRoutes] Connectivity test failed:', error]));
        res.status(500).json({
            error: 'Internal server error',
            message: 'Failed to test webhook connectivity'
        });
    }
});

/**
 * Health check for webhook service
 */
webhookRouter.get('/health', (_req: Request, res: Response) => {
    const config = getWebhookConfig();
    
    if (!config || config.urls.length === 0) {
        return res.status(200).json({
            status: 'disabled',
            message: 'Webhook service is disabled (no URLs configured)'
        });
    }

    return res.status(200).json({
        status: 'active',
        urls: config.urls.length,
        maxRetries: config.maxRetries,
        timeoutMs: config.timeoutMs
    });
});
