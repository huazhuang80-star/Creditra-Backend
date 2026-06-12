# API Response Envelope

The Creditra Backend wraps every JSON response in a consistent envelope so
that clients can branch on the presence of an `error` field without having
to know endpoint-specific shapes.

```jsonc
// Success
{ "data": { "id": "...", "amount": "100.00" }, "error": null }

// Failure
{ "data": null, "error": "Validation failed: amount must be positive" }
```

## Rules

- Exactly one of `data` / `error` is non-null at any time.
- `error` is always a human-readable string. Structured error details
  (codes, fields) are intentionally omitted from this generic envelope;
  endpoint-specific error structures, where they exist, live inside
  `data` on `4xx` responses.
- For `5xx` responses, the envelope deliberately hides internal error
  messages. Clients should treat `error` as opaque text and rely on the
  HTTP status for retry logic.

## Helpers

Use `ok(res, payload, status?)` and `fail(res, error, status?)` from
`src/utils/response.ts` instead of building envelopes inline. This keeps
internal details (stack traces, SQL errors) from leaking into 5xx
responses by default.
