# Observability

The backend is built to be debuggable from a single correlation ID. This document explains how to read its logs, what metrics it surfaces, which health probes exist, and how to wire it into a production observability stack.

---

## 1. Structured Logging

### 1.1 Logger

A single Pino logger lives in [`src/utils/logger.ts`](../src/utils/logger.ts) and is reused everywhere. JSON-by-default, ISO timestamps, silent in `NODE_ENV=test`. Plug a `pino-pretty` sidecar in dev only.

### 1.2 Correlation IDs

Every inbound request is assigned a UUID (or honoured if a client supplies `x-request-id`) by [`src/middleware/requestLogger.ts`](../src/middleware/requestLogger.ts) and echoed back in the response. The same id is attached to `req.requestId` so downstream handlers can include it in domain logs.

Sample request log pair:

```json
{ "level":30,"requestId":"e3...","method":"POST","path":"/api/risk/evaluate","msg":"request:start" }
{ "level":30,"requestId":"e3...","method":"POST","path":"/api/risk/evaluate","statusCode":200,"durationMs":42,"walletAddress":"GDRXE2...4SOU","msg":"request:end" }
```

Notice `walletAddress` is **sanitized** to `first6...last4` so logs are useful without leaking the full pubkey.

### 1.3 Redaction

[`src/utils/logRedact.ts`](../src/utils/logRedact.ts) walks string args, object values, and `Error.message`, redacting any Stellar address (`G[A-Z2-7]{55}`) to `Gxxxxx...xxxx`. Call sites should prefer the helpers `redactLogArgs(...)` or `redactObject(...)` when constructing log lines from external strings.

Set `LOG_REDACTION_DEBUG=1` to suppress redaction temporarily during incident response.

---

## 2. Metrics Inventory

### 2.1 HorizonListener metrics

`getMetrics()` returns a `HorizonListenerMetrics` snapshot. Recommended scrape interval: 15 s.

| Metric | Type | Notes |
|---|---|---|
| `totalPolls` | counter | Total tick attempts |
| `successfulPolls` | counter | Polls that finished without error |
| `failedPolls` | counter | Polls that errored or timed out |
| `eventsProcessed` | counter | Events handed to handlers |
| `eventsDuplicated` | counter | Events suppressed by `eventId` dedup |
| `retryAttempts` | counter | Backoff-driven retries |
| `rateLimitHits` | counter | 429s from Horizon |
| `cursorGapsDetected` | counter | Gaps observed |
| `cursorGapsRecovered` | counter | Gaps successfully backfilled |
| `lastSuccessfulPoll` | ISO timestamp | Use for staleness alert |
| `lastError` | string | Most recent failure summary (redacted) |
| `averagePollTime` | ms | Rolling poll latency |

### 2.2 Job queue health

Exposed via `GET /api/reconciliation/status`:

```json
{
  "data": {
    "workerRunning": true,
    "queueSize": 0,
    "failedJobs": 0
  },
  "error": null
}
```

Pair this with a scraper that polls every 30 s and alerts on `failedJobs > 0` or `workerRunning == false` for > 2 min.

### 2.3 Rate-limit telemetry

Every response carries:

- `X-RateLimit-Limit`
- `X-RateLimit-Remaining`
- `X-RateLimit-Reset`

Aggregating these in the edge (nginx/envoy) gives a per-key saturation signal. 429 responses additionally include `Retry-After` so clients can self-throttle.

### 2.4 Request-level RED metrics

The request logger emits `durationMs` and `statusCode` on every request. Pumping these into a counter+histogram (e.g. via `pino → vector → loki` or `pino → otel`) yields the standard **R**ate / **E**rrors / **D**uration triad without additional instrumentation in code.

### 2.5 Webhook telemetry

`drawWebhookService` logs every delivery with `requestId`-style identifiers, attempt count, and HTTP status. The connectivity probe `POST /api/webhooks/test` returns a synchronous summary of subscriber reachability. Suggested alert: `unreachable > 0 for 5 min`.

---

## 3. Health Endpoints

### 3.1 `GET /health` — combined readiness

`/health` runs both checks in parallel:

| Probe | Timeout | Returns |
|---|---|---|
| DB (`SELECT 1`) | 1 s | `ok` / `unconfigured` / `degraded` |
| Horizon (HEAD-like fetch of `HORIZON_URL`) | 2 s | `ok` / `degraded` |

Response envelope:

```json
{
  "data": {
    "status": "ok",
    "service": "creditra-backend",
    "ready": true,
    "dependencies": {
      "database": { "status": "ok" },
      "horizon":  { "status": "ok" }
    }
  },
  "error": null
}
```

`ready === true` iff every dependency reports `ok`. Use this for both **liveness** (HTTP 200) and **readiness** (`data.ready`). For Kubernetes:

```yaml
livenessProbe:
  httpGet: { path: /health, port: 3000 }
  periodSeconds: 30
readinessProbe:
  httpGet: { path: /health, port: 3000 }
  periodSeconds: 10
  failureThreshold: 3
```

### 3.2 `GET /api/webhooks/health`

Returns `disabled` (no URLs configured) or `active` with the count and timeout. Useful for green-status board entries.

### 3.3 Future `/readyz` and `/healthz` split

If you need stricter Kubernetes semantics (liveness must succeed even when a dependency is degraded), split:

- `/healthz` — return 200 unconditionally if the process is alive and the event loop responsive.
- `/readyz` — current `/health` semantics, gating traffic.

Both can be added as routes that compose the existing helpers — see the implementation of `checkDatabase()` / `checkHorizon()` in [`src/routes/health.ts`](../src/routes/health.ts).

---

## 4. Tracing Strategy

No distributed tracing ships in code today. The `requestId` correlation is the on-ramp:

1. **In-process spans.** Wrap a service call with a logger.child({ requestId }) and time it with `Date.now()` deltas.
2. **OpenTelemetry adoption path.** Replace the Pino logger with `@opentelemetry/instrumentation-express` and `pino-otel`, and the `requestId` becomes the trace id. The seam points are:
   - `requestLogger` middleware — already extracts `x-request-id`.
   - Every outbound HTTP call goes through `fetchWithTimeout` — wrap it to inject `traceparent`.
   - Job queue handlers receive the full `payload` — propagate the parent trace via the job options.

The current code paths already log `requestId` consistently, so adding traces does not require touching domain code.

---

## 5. Dashboards & Alerts (suggested)

A baseline dashboard for this service:

| Panel | Query (Loki / PromQL flavour) | Alert |
|---|---|---|
| Request rate | sum by(path) rate({app="creditra"} \| msg = "request:end" [1m]) | none |
| 5xx ratio | sum(rate(.. statusCode≥500 [5m])) / sum(rate(.. [5m])) | > 1 % for 5 min → page |
| p95 latency | quantile_over_time(0.95, durationMs[5m]) | > 500 ms for 10 min → ticket |
| Listener freshness | `time() - parse_time(lastSuccessfulPoll)` | > 5 × `POLL_INTERVAL_MS` → page |
| Listener failures | rate(failedPolls[5m]) | > 0.1/s for 10 min → ticket |
| Rate-limit hits | rate(rateLimitHits[5m]) | sustained → tune `HORIZON_RATE_LIMIT_DELAY_MS` |
| Cursor gaps | increase(cursorGapsDetected[1h]) - increase(cursorGapsRecovered[1h]) | > 0 → ticket |
| Queue depth | reconciliation `queueSize` | > 10 for 30 min → ticket |
| Failed jobs | reconciliation `failedJobs` | > 0 → page |
| DB probe | `/health` `dependencies.database.status != "ok"` | sustained → page |
| Horizon probe | `/health` `dependencies.horizon.status != "ok"` | sustained → ticket (upstream) |
| Webhook reachability | `/api/webhooks/test` `unreachable > 0` | sustained → ticket |

---

## 6. Local Observability Loop

```bash
# In one terminal
npm run dev

# In another, a simple JSON log viewer
curl -s http://localhost:3000/api/credit/lines | jq
tail -f /tmp/creditra-backend.log | jq '. | {ts,msg,requestId,method,path,statusCode,durationMs}'
```

For prettified logs in dev, pipe through `pino-pretty`:

```bash
node dist/index.js | npx pino-pretty
```

---

## 7. References

- [`src/utils/logger.ts`](../src/utils/logger.ts)
- [`src/utils/logRedact.ts`](../src/utils/logRedact.ts)
- [`src/middleware/requestLogger.ts`](../src/middleware/requestLogger.ts)
- [`src/routes/health.ts`](../src/routes/health.ts)
- [`src/services/horizonListener.ts`](../src/services/horizonListener.ts) (`getMetrics()`)
- [`src/routes/reconciliation.ts`](../src/routes/reconciliation.ts) (`/status`)
- [`src/routes/webhook.ts`](../src/routes/webhook.ts) (`/health`, `/test`)
