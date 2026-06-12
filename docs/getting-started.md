# Getting Started

A condensed onboarding path for new contributors. The full reference lives
in the top-level `README.md`; this document is the shortest route to a
working local environment.

## Prerequisites

- Node.js (see `engines.node` in `package.json` for the supported range)
- npm (ships with Node.js)
- Docker, if you want to run Postgres via `docker-compose.yml`

## First-time setup

```bash
# Install dependencies (use ci in CI/automation contexts)
npm install

# Copy the example env file and fill in any required secrets
cp .env.example .env

# Optional: start Postgres locally
docker-compose up -d db

# Apply migrations
npm run db:migrate
```

## Common scripts

| Command                 | Purpose                                       |
| ----------------------- | --------------------------------------------- |
| `npm run dev`           | Start the API with hot-reload via tsx         |
| `npm run build`         | Type-check and emit JS to `dist/`             |
| `npm run typecheck`     | Run `tsc --noEmit` without emitting           |
| `npm run lint`          | Lint `src/` with ESLint                       |
| `npm test`              | Run the Vitest suite once                     |
| `npm run test:watch`    | Run Vitest in watch mode                      |
| `npm run validate:spec` | Validate the OpenAPI spec parses cleanly      |

## What to read next

- `README.md` — full feature index, architecture diagrams, configuration.
- `docs/utils.md` — utility module conventions.
- `docs/error-envelope.md` — API response shape contract.
- `docs/troubleshooting.md` — quick fixes for common failures.
