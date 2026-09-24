# OpenMat (working name)

Free, open-source software for running wrestling tournaments: registration, weigh-ins, youth "Madison" grouping, brackets, mat scheduling, live table scoring, and on-deck / in-the-hole alerts for fans.

Built so a tournament director, not a programmer, can run it.

**Status:** early. Core tournament logic only, no app yet. See [PLAN.md](PLAN.md).

## Packages

- `packages/core`: pure TypeScript logic, no UI or database.
  - Age divisions (8U/10U/12U/14U by birth year)
  - Youth weight grouping: groups kids of similar weight (default within 10%), flags anything outside the rules, and supports moving a kid **up** an age or weight group (never down)
  - Round robin pairings and pool standings with tiebreakers
  - Official weight classes (NFHS, USAW kids) and weigh-in checks
  - Single and double elimination brackets (consolation, true second, byes, draws that keep teammates apart)
  - Mat scheduler with rest between matches, bout numbers, and live on deck / in the hole estimates

## Development

Requires Node 24+ and pnpm.

```sh
pnpm install
pnpm test
pnpm typecheck
```

## License

MIT
