/**
 * Outbound webhook fan-out for confirmed draw events.
 *
 * Drives the protocol's "the chain saw your draw" notification path.
 * Subscriber URLs come from `WEBHOOK_URLS` (comma-separated) and the HMAC
 * secret from `WEBHOOK_SECRET`. Retries follow exponential backoff bounded
 * by `WEBHOOK_MAX_RETRIES`.
 *
 * Signature contract sent to subscribers:
 * - `X-Webhook-Signature: sha256=<hex HMAC over raw body>`
 * - `X-Webhook-Timestamp: <ms since epoch>`
 * - `User-Agent: Creditra-Webhook/1.0`
 *
 * Subscribers must (a) re-compute the HMAC and compare in constant time,
 * (b) reject timestamps outside their tolerance window, and
 * (c) deduplicate by `data.drawId`. See `docs/API.md` §Webhooks.
 */
import { createHmac } from "node:crypto";
import type { HorizonEvent } from "./horizonListener.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface WebhookPayload {
    /** Event type - always 'draw_confirmed' for this service */
    event: "draw_confirmed";
    /** Timestamp when the webhook was generated */
    timestamp: string;
    /** The original Horizon event that triggered this webhook */
    data: {
        ledger: number;
        contractId: string;
        drawAmount: string;
        drawId: string;
        borrowerWallet: string;
        creditLineId: string;
        horizonTimestamp: string;
    };
}

export interface WebhookConfig {
    /** Webhook endpoint URLs (comma-separated) */
    urls: string[];
    /** HMAC secret for signing payloads */
    secret: string;
    /** Maximum retry attempts */
    maxRetries: number;
    /** Initial backoff delay in milliseconds */
    initialBackoffMs: number;
    /** Backoff multiplier */
    backoffMultiplier: number;
    /** Request timeout in milliseconds */
    timeoutMs: number;
}

export interface WebhookDeliveryResult {
    url: string;
    success: boolean;
    attempt: number;
    error?: string;
    responseStatus?: number;
}

// ---------------------------------------------------------------------------
// Internal state
// ---------------------------------------------------------------------------

let activeConfig: WebhookConfig | null = null;

// ---------------------------------------------------------------------------
// Configuration helpers
// ---------------------------------------------------------------------------

export function resolveWebhookConfig(): WebhookConfig {
    const urlsRaw = process.env["WEBHOOK_URLS"] ?? "";
    const urls = urlsRaw
        ? urlsRaw.split(",").map((url) => url.trim()).filter(Boolean)
        : [];

    const secret = process.env["WEBHOOK_SECRET"] ?? "";
    
    if (urls.length > 0 && !secret) {
        throw new Error("WEBHOOK_SECRET is required when WEBHOOK_URLS is configured");
    }

    const maxRetries = parseInt(
        process.env["WEBHOOK_MAX_RETRIES"] ?? "3",
        10
    );

    const initialBackoffMs = parseInt(
        process.env["WEBHOOK_INITIAL_BACKOFF_MS"] ?? "1000",
        10
    );

    const backoffMultiplier = parseFloat(
        process.env["WEBHOOK_BACKOFF_MULTIPLIER"] ?? "2.0"
    );

    const timeoutMs = parseInt(
        process.env["WEBHOOK_TIMEOUT_MS"] ?? "10000",
        10
    );

    return { urls, secret, maxRetries, initialBackoffMs, backoffMultiplier, timeoutMs };
}

// ---------------------------------------------------------------------------
// HMAC Signature utilities
// ---------------------------------------------------------------------------

function generateSignature(payload: string, secret: string): string {
    return createHmac("sha256", secret)
        .update(payload, "utf8")
        .digest("hex");
}

// ---------------------------------------------------------------------------
// HTTP delivery utilities
// ---------------------------------------------------------------------------

async function deliverWebhook(
    url: string,
    payload: WebhookPayload,
    signature: string,
    timeoutMs: number
): Promise<{ success: boolean; status?: number; error?: string }> {
    const payloadString = JSON.stringify(payload);
    
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    try {
        const response = await fetch(url, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "X-Webhook-Signature": `sha256=${signature}`,
                "X-Webhook-Timestamp": payload.timestamp,
                "User-Agent": "Creditra-Webhook/1.0"
            },
            body: payloadString,
            signal: controller.signal
        });

        clearTimeout(timeoutId);

        if (response.ok) {
            return { success: true, status: response.status };
        } else {
            return { 
                success: false, 
                status: response.status, 
                error: `HTTP ${response.status}: ${response.statusText}` 
            };
        }
    } catch (error) {
        clearTimeout(timeoutId);
        
        if (error instanceof Error) {
            if (error.name === "AbortError") {
                return { success: false, error: "Request timeout" };
            }
            return { success: false, error: error.message };
        }
        
        return { success: false, error: "Unknown error occurred" };
    }
}

// ---------------------------------------------------------------------------
// Retry logic with exponential backoff
// ---------------------------------------------------------------------------

async function retryWithBackoff<T>(
    fn: () => Promise<T>,
    maxRetries: number,
    initialBackoffMs: number,
    backoffMultiplier: number
): Promise<{ result: T; attempts: number }> {
    let lastError: Error;
    let delay = initialBackoffMs;

    for (let attempt = 1; attempt <= maxRetries + 1; attempt++) {
        try {
            const result = await fn();
            return { result, attempts: attempt };
        } catch (error) {
            lastError = error as Error;
            
            if (attempt <= maxRetries) {
                console.warn(
                    `[DrawWebhook] Attempt ${attempt} failed, retrying in ${delay}ms:`,
                    lastError.message
                );
                await new Promise(resolve => setTimeout(resolve, delay));
                delay = Math.floor(delay * backoffMultiplier);
            }
        }
    }

    throw lastError!;
}

// ---------------------------------------------------------------------------
// Event processing
// ---------------------------------------------------------------------------

function parseDrawConfirmedEvent(event: HorizonEvent): WebhookPayload | null {
    // Check if this is a draw confirmation event
    if (!event.topics.includes("draw_confirmed")) {
        return null;
    }

    try {
        const eventData = JSON.parse(event.data);
        
        return {
            event: "draw_confirmed",
            timestamp: new Date().toISOString(),
            data: {
                ledger: event.ledger,
                contractId: event.contractId,
                drawAmount: eventData.drawAmount || "0",
                drawId: eventData.drawId || "",
                borrowerWallet: eventData.borrowerWallet || "",
                creditLineId: eventData.creditLineId || "",
                horizonTimestamp: event.timestamp
            }
        };
    } catch (error) {
        console.error("[DrawWebhook] Failed to parse event data:", error);
        return null;
    }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function getWebhookConfig(): WebhookConfig | null {
    return activeConfig;
}

export function initializeWebhooks(): void {
    try {
        activeConfig = resolveWebhookConfig();
        console.log("[DrawWebhook] Initialized with config:", {
            urls: activeConfig.urls.length,
            maxRetries: activeConfig.maxRetries,
            timeoutMs: activeConfig.timeoutMs
        });
    } catch (error) {
        console.error("[DrawWebhook] Failed to initialize:", error);
        activeConfig = null;
    }
}

export async function sendDrawConfirmationWebhook(
    event: HorizonEvent
): Promise<WebhookDeliveryResult[]> {
    if (!activeConfig || activeConfig.urls.length === 0) {
        console.log("[DrawWebhook] No webhook URLs configured, skipping");
        return [];
    }

    const payload = parseDrawConfirmedEvent(event);
    if (!payload) {
        console.log("[DrawWebhook] Event is not a draw confirmation, skipping");
        return [];
    }

    const payloadString = JSON.stringify(payload);
    const signature = generateSignature(payloadString, activeConfig.secret);

    console.log(
        `[DrawWebhook] Processing draw confirmation for draw ID: ${payload.data.drawId}`
    );

    const deliveryPromises = activeConfig.urls.map(async (url) => {
        try {
            const { result, attempts } = await retryWithBackoff(
                () => deliverWebhook(url, payload, signature, activeConfig!.timeoutMs),
                activeConfig!.maxRetries,
                activeConfig!.initialBackoffMs,
                activeConfig!.backoffMultiplier
            );

            return {
                url,
                success: result.success,
                attempt: attempts,
                responseStatus: result.status,
                error: result.error
            };
        } catch (error) {
            return {
                url,
                success: false,
                attempt: activeConfig!.maxRetries + 1,
                error: error instanceof Error ? error.message : "Unknown error"
            };
        }
    });

    const results = await Promise.all(deliveryPromises);
    
    const successCount = results.filter(r => r.success).length;
    const failureCount = results.length - successCount;
    
    console.log(
        `[DrawWebhook] Delivery complete: ${successCount} successful, ${failureCount} failed`
    );

    return results;
}

// ---------------------------------------------------------------------------
// Health check utilities
// ---------------------------------------------------------------------------

export async function testWebhookConnectivity(): Promise<{
    url: string;
    reachable: boolean;
    error?: string;
}[]> {
    if (!activeConfig || activeConfig.urls.length === 0) {
        return [];
    }

    const testPayload: WebhookPayload = {
        event: "draw_confirmed",
        timestamp: new Date().toISOString(),
        data: {
            ledger: 0,
            contractId: "test",
            drawAmount: "0",
            drawId: "test",
            borrowerWallet: "test",
            creditLineId: "test",
            horizonTimestamp: new Date().toISOString()
        }
    };

    const payloadString = JSON.stringify(testPayload);
    const signature = generateSignature(payloadString, activeConfig.secret);

    const testPromises = activeConfig.urls.map(async (url) => {
        try {
            const result = await deliverWebhook(url, testPayload, signature, 5000);
            return {
                url,
                reachable: result.success,
                error: result.error
            };
        } catch (error) {
            return {
                url,
                reachable: false,
                error: error instanceof Error ? error.message : "Unknown error"
            };
        }
    });

    return Promise.all(testPromises);
}
