Engineering Quality Guardrails

Purpose

- Keep quality gates fast, reliable, and hard to bypass.
- Prevent quality regressions by enforcing a stable baseline in CI.

Required checks

- `bun run lint`
- `bun run typecheck:strict`
- `bun run test:fast`
- Combined gate: `bun run verify`

Git hook policy

- Pre-commit runs `lint-staged` on staged files only.
- Pre-push runs lint, strict typecheck, and fast tests.
- Full and heavier suites remain in CI (`bun run test` and E2E workflows).

Lint and typing policy

- `eslint-disable` comments must include a short reason and reference to a tracking issue when possible.
- Avoid `any`; prefer explicit types or `unknown` with narrowing.
- If `any` is unavoidable, add a short justification near the usage and track cleanup in an issue.
- Test files follow the same lint rule severity as source files.
- No lint rule relaxations are allowed for tests (`*.test.ts` or `__tests__` paths).
- Do not add test-only ESLint overrides, downgrades, or disable lists in config.

PR expectations

- No net increase in lint errors or type errors.
- New suppressions (`eslint-disable`, `@ts-expect-error`, `any`) must be justified.
- No PR may introduce test-only lint relaxations or test-specific rule downgrades.
- Quality workflow should be green before merge.

Branch protection

- Require the `quality` workflow for merge.
- Keep existing domain workflows (`arena-e2e`, `starter-contract`) as required checks.
