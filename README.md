# OpenMat (working name)

Free, open-source software for running wrestling tournaments: registration, weigh-ins, youth "Madison" grouping, brackets, mat scheduling, live table scoring, and on-deck / in-the-hole alerts for fans.

Built so a tournament director, not a programmer, can run it.

**Status:** early. The core logic is done. The web app covers event setup, registration, weigh-ins and youth grouping; brackets, table scoring and the live mat board are next. See [PLAN.md](PLAN.md).

## Core logic

- `packages/core`: pure TypeScript logic, no UI or database.
  - Age divisions (8U/10U/12U/14U by birth year)
  - Youth weight grouping: groups kids of similar weight (default within 10%), flags anything outside the rules, and supports moving a kid **up** an age or weight group (never down)
  - Round robin pairings and pool standings with tiebreakers
  - Official weight classes (NFHS, USAW kids) and weigh-in checks
  - Single and double elimination brackets (consolation, true second, byes, draws that keep teammates apart)
  - Mat scheduler with rest between matches, bout numbers, and live on deck / in the hole estimates
  - Rulesets (high school, USAW kids, college, freestyle, Greco-Roman) and live bout scoring with full correction history

## Packages and apps

- `apps/api`: Fastify + Postgres (Drizzle) API. Staff sign in with secret links (director, weigh-in, one per mat), no accounts.
- `apps/web`: React + Vite web app (setup wizard, director dashboard, weigh-in station, public event page).

## Development

Requires Node 24+, pnpm and Docker.

```sh
pnpm install
pnpm db:up        # Postgres in Docker on port 5433
pnpm db:migrate
pnpm dev          # API on :3001, web on http://localhost:5173
pnpm test         # core + API tests (API tests use the openmat_test database)
pnpm typecheck
```

First time only, create the test database:
`docker exec openmat-db psql -U openmat -c "create database openmat_test"`

## License

MIT
