# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Development Commands

- **Build**: `npm run build` — compiles TypeScript to `/build`
- **Watch**: `npm run watch` — recompile on change
- **Dev**: `npm run dev` — run the server straight from TypeScript source via tsx (no build step)
- **All tests**: `npm test` — one vitest run of `src/**/*.test.ts`
- **Single test file**: `npm test -- src/utils.test.ts`
- **Single test by name**: `npm test -- -t "substring of test name"`
- **Watch / UI / coverage**: `npm run test:watch`, `npm run test:ui`, `npm run test:coverage`

CI (`.github/workflows/test.yml`) runs `npm ci`, `npm test`, `npm run build` on Node 18.x, 20.x, and 22.x for every push/PR to main. The Node 20 job uploads `./coverage/coverage-final.json` to Codecov. Changes must keep tests and build green on all three Node versions.

## Project Architecture

Minimal Model Context Protocol (MCP) server that integrates TMetric time tracking with Claude Code and other MCP clients.

### File Structure

- `src/types.ts` — interfaces for TMetric API entities and responses
- `src/utils.ts` — duration calculation and issue-URL parsing (GitHub and GitLab)
- `src/tmetric-client.ts` — TMetric API client with all timer operations
- `src/index.ts` — MCP server entry point; registers tools, stdio transport
- `src/utils.test.ts`, `src/tmetric-client.test.ts` — vitest suites
- `TESTING.md` — testing stack and how to write new tests (read this before adding tests)
- `docs/plans/` — approved design docs; `2025-11-09-delete-stopped-entries-design.md` records why `delete_time_entry` is mode-based with a 5-minute safety window
- `docs/IMPLEMENTATION_INSTRUCTIONS.md` — historical bootstrap spec. Out of date (old `entry_id` delete API, GitLab-only helpers). Do not follow it; treat as history only.

### Core Architecture Patterns

**TMetricClient class** (`src/tmetric-client.ts`):
- Lazy initialization: `accountId` is fetched once from `GET /user` (field `activeAccountId`) via `ensureInitialized()` on the first API call. It is the ONLY cached state.
- Timer state is never cached: every check re-queries today's entries from the API. The active timer is the entry with `endTime === null`.
- Methods return structured `ApiResponse` objects (`{success, error?, message?, ...}`) instead of throwing. Two exceptions throw on failure: `getCurrentTimer()` (returns `TimerInfo`) and `initialize()`.
- `stopTimer()` builds `endTime` as a LOCAL-time ISO string with the trailing `Z` removed (shifts by the timezone offset) so it matches the local-time format TMetric uses for `startTime`. It PUTs a hand-built minimal body: `startTime`, `endTime`, `project.id`, `tags`, plus `task` (with `externalLink`/`integration` when present) or `note`.

**MCP Server** (`src/index.ts`):
- Single shared `TMetricClient` instance across all tool calls
- Tools registered with JSON schemas; every response is JSON-serialized into MCP text content; stdio transport
- Outer try/catch turns any thrown error into `{success: false, error: 'INTERNAL_ERROR'}` with `isError: true`

### API Integration

- Base URL: `https://app.tmetric.com/api/v3`, Bearer token from `TMETRIC_API_TOKEN` (the only environment variable; the server exits at startup if unset)
- Account-scoped endpoints: `GET/POST /accounts/{accountId}/timeentries`, `PUT/DELETE /accounts/{accountId}/timeentries/{id}`
- `POST` with `startTime: null` means "start now"

### Critical Implementation Details

**Single Timer Enforcement**: `startTimer()` checks for a running timer first and returns `TIMER_ALREADY_RUNNING` (with `current_timer` attached) instead of creating a second entry.

**Issue URL Integration** (GitHub and GitLab) — when `task_url` is passed to `start_timer`:
1. `extractIssueNumber()` matches `/issues\/(\d+)/` (fits both GitHub and GitLab URLs)
2. `detectIntegrationType()` returns `'GitHub'` when the host contains `github.com`, otherwise `'GitLab'` (also the fallback for unparseable URLs)
3. The task gets `externalLink: {link, issueId: "<Type> Issue: #123"}` and `integration: {url: <base URL>, type}`
4. No issue number in the URL → the URL is silently ignored (plain task, no integration fields)

**delete_time_entry modes** (see the design doc in `docs/plans/`): mode `'current'` (default) deletes only the running timer; mode `'last'` deletes today's most recent entry but refuses if it stopped more than 5 minutes ago. Deliberately no delete-by-ID — the design doc says specific-entry management belongs in the TMetric web UI. Error codes: `NO_TIMER_RUNNING`, `NO_ENTRIES_FOUND`, `ENTRY_TOO_OLD`, `API_ERROR`.

**Time Formats**: `calculateElapsed()` → `"Xh Ym"` / `"Ym"` (with space, for display of running timers); `formatMinutesToGitLab()` → `"XhYm"` / `"Xh"` / `"Ym"` (no space, GitLab time-tracking syntax).

## MCP Tools Exposed

- `list_tmetric_projects` — projects available for time tracking
- `get_current_timer` — whether a timer is running, plus its details
- `start_timer(project_id, task_name, task_url?)` — fails if a timer is already running; `task_url` may be a GitLab or GitHub issue URL
- `stop_timer` — stops the active timer, returns time spent in GitLab format
- `delete_time_entry(mode?: 'current' | 'last')` — see modes above

## Testing

- Vitest with `nock` for HTTP interception: mock every request a test will trigger BEFORE calling the client method, and call `nock.cleanAll()` in both `beforeEach` and `afterEach`
- Use `vi.useFakeTimers()` + `vi.setSystemTime()` for anything touching elapsed time — `calculateElapsed()` reads the live clock
- Coverage thresholds: 80% lines/functions/branches/statements (v8 provider). `src/index.ts` is deliberately excluded from coverage and has no unit tests — don't add them to raise the score
- Details in `TESTING.md`

## Package Structure

- ESM (`"type": "module"`); package `@guglielmo/tmetric-minimal-mcp` v2.0.0
- Binary: `tmetric-minimal-mcp` → `build/index.js`; only `/build` is published (`files` field); `prepare` script builds on install
- Dependencies: `@modelcontextprotocol/sdk`, `axios`, `date-fns`; dev: vitest (+ coverage-v8, ui), nock, tsx
