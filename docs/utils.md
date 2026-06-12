# Utilities (`src/utils/`)

This directory holds small, dependency-free helpers that are reused across
the route, service, and repository layers. Anything placed here MUST:

- Be **pure** (no I/O, no environment lookup) or wrap an explicit dependency.
- Have **no imports from `src/services/`, `src/routes/`, or `src/repositories/`**
  to avoid creating dependency cycles.
- Be **covered by unit tests** in `src/utils/__tests__/`.

## Module index

| Module             | Purpose                                                   |
| ------------------ | --------------------------------------------------------- |
| `constants.ts`     | Pagination and body-size defaults shared by API endpoints |
| `fetchWithTimeout` | HTTP client with structured timeout and request errors    |
| `httpStatus.ts`    | Named HTTP status code constants                          |
| `logger.ts`        | Process-wide pino logger configuration                    |
| `logRedact.ts`     | Helpers for redacting sensitive values from log lines     |
| `numbers.ts`       | `clamp`, `isFiniteInteger`, `parsePositiveInt`            |
| `response.ts`      | `ok` / `fail` for the standard `ApiResponse` envelope     |
| `stellarAddress.ts`| Validation/redaction helpers for Stellar addresses        |
| `strings.ts`       | `isNonEmptyString`, `truncate`, `capitalize`              |
| `time.ts`          | Duration constants and `sleep` / `nowSeconds` helpers     |

## Adding a new utility

1. Create the module in `src/utils/<name>.ts` with full JSDoc.
2. Add unit tests in `src/utils/__tests__/<name>.test.ts`.
3. Update the table above.
4. Avoid introducing transitive runtime dependencies; helpers should be
   importable from any layer without side effects.
