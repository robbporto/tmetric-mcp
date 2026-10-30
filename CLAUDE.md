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

Model Context Protocol (MCP) server that integrates TMetric time tracking with Claude Code and other MCP clients.

### File Structure

- `src/types.ts` — interfaces for TMetric API entities and responses
- `src/utils.ts` — duration calculation and issue-URL parsing (GitHub, GitLab, YouTrack)
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
- Closing an entry is shared logic: `localNow()` builds a LOCAL-time ISO string with the trailing `Z` removed (shifts by the timezone offset) so it matches the local-time format TMetric uses for `startTime`; `closeTimeEntry()` PUTs a hand-built minimal body: `startTime`, `endTime`, `project.id`, `tags`, plus `task` (with `externalLink`/`integration` when present) and, whenever the entry has one, `note` — the PUT replaces the entry, so omitting the note would erase it (same rule as `updateTimeEntry`). Both `stopTimer()` and the `startTimer()` switch path use these helpers.

**MCP Server** (`src/index.ts`):
- Single shared `TMetricClient` instance across all tool calls
- Tools registered with JSON schemas; every response is JSON-serialized into MCP text content; stdio transport
- Outer try/catch turns any thrown error into `{success: false, error: 'INTERNAL_ERROR'}` with `isError: true`

### API Integration

- Base URL: `https://app.tmetric.com/api/v3`, Bearer token from `TMETRIC_API_TOKEN` (the only environment variable; the server exits at startup if unset)
- Account-scoped endpoints: `GET/POST /accounts/{accountId}/timeentries`, `PUT/DELETE /accounts/{accountId}/timeentries/{id}`
- `POST` with `startTime: null` means "start now"
- Verified against the real API (2026-10-30): `PUT /timeentries/{id}` REPLACES the entry and assigns it a NEW id (the old id stops existing); any field left out of the body is cleared (omitting `note`, `note: ""` and `note: null` all clear the note); `POST` and `PUT` respond with an ARRAY of entries (other entries of the same day too, so never take `data[0]`); `GET /timeentries/{id}` returns 405 (no single-entry GET)

### Critical Implementation Details

**Timer Switching**: `startTimer()` never leaves two timers running. If a timer is running, it closes that entry via `closeTimeEntry()` and creates the new entry with `startTime` set to the identical local timestamp — same second on both, so TMetric can never show a "Break" between them. The success response then carries `switched_from` (`task_name`, `time_spent`, `time_spent_minutes`, `started_at`, `ended_at`). Ordering guarantees: tags are validated before any write (an unknown tag leaves the running timer untouched); if closing the old entry fails, no new entry is created (`API_ERROR`, "no new timer was started"); if creating the new entry fails after the close, the `API_ERROR` message says the previous timer was already stopped.

**Issue URL Integration** (GitHub, GitLab, YouTrack) — `parseIssueUrl()` in `src/utils.ts` is the single entry point used by `start_timer`, `create_time_entry`, and `update_time_entry`:
1. `detectIntegrationType()`: `'GitHub'` when the host contains `github.com`; `'YouTrack'` when the host contains `youtrack` or the path matches `/issue/KEY-123`; otherwise `'GitLab'` (also the fallback for unparseable URLs)
2. GitHub/GitLab: issue number from `/issues\/(\d+)/`, displayed as `"<Type> Issue: #123"`. YouTrack: the bare issue key (e.g. `ABC-123`) — the exact `'YouTrack'` type string and bare-key format match TMetric's official browser extension
3. The task gets `externalLink: {link, issueId}` and `integration: {url: <base URL>, type}`
4. No recognizable issue in the URL → `start_timer`/`create_time_entry` silently ignore the URL; `update_time_entry` returns `INVALID_TASK_URL`

**Tags** are API objects (`{id, name, isWorkType}`), never plain strings. Tool inputs take tag *names*; `resolveTags()` matches them (case-insensitive) against `GET /accounts/{accountId}/timeentries/tags` and errors on unknown names (`UNKNOWN_TAG`) — no silent tag creation. At most one `isWorkType` tag per entry (`INVALID_TAGS`).

**update_time_entry** has no single-entry GET to lean on (the API only defines PUT/DELETE on `/timeentries/{id}`), so it finds the entry by scanning a window of 31 days back to 7 days forward — or exactly `entry_date` when given — then PUTs the full merged body (fetched values for anything not being changed, including a `note` carried alongside the task). The lookup lives in the private `findEntryById()`, shared with delete-by-ID. Because the PUT replaces the entry and assigns a new id, the response's `entry_id` is the NEW id (`previous_entry_id` is the one passed in), found by content match in the PUT response, then in a GET of the entry's day; if neither identifies it uniquely, `entry_id` is `null` with an explanatory message. `note`: omitted keeps the existing note, a string sets it, the exact empty string `""` is left out of the body, which clears it. User-supplied times must match `LOCAL_TIME_PATTERN` (local ISO, no `Z`/offset suffix) or they are rejected with `INVALID_TIME_FORMAT` — a `Z`-suffixed time would be stored at the wrong hour.

**delete_time_entry modes** (see the design doc in `docs/plans/`): mode `'current'` (default) deletes only the running timer; mode `'last'` deletes today's most recent entry but refuses if it stopped more than 5 minutes ago. Optional `entry_id` (+ `entry_date`) deletes that specific stopped entry instead, ignoring mode (same lookup window as `update_time_entry`); a running entry is refused with `ENTRY_RUNNING` (stop it first). Delete-by-ID was added on 2026-10-30 on request, superseding the design doc's "no delete-by-ID" stance; the 5-minute rule still applies to mode `'last'`. Error codes: `NO_TIMER_RUNNING`, `NO_ENTRIES_FOUND`, `ENTRY_TOO_OLD`, `ENTRY_RUNNING`, `ENTRY_NOT_FOUND`, `INVALID_DATE_FORMAT`, `API_ERROR`.

**Time Formats**: `calculateElapsed()` → `"Xh Ym"` / `"Ym"` (with space, for display of running timers); `formatMinutesToGitLab()` → `"XhYm"` / `"Xh"` / `"Ym"` (no space, GitLab time-tracking syntax).

## MCP Tools Exposed

- `list_tmetric_projects` — projects available for time tracking
- `list_tmetric_tags` — tags available for the `tags` parameter, with `is_work_type` flags
- `get_current_timer` — whether a timer is running, plus its details
- `start_timer(project_id, task_name, task_url?, tags?)` — if a timer is already running it is stopped on the same timestamp the new one starts (reported as `switched_from`); `task_url` may be a GitLab, GitHub or YouTrack issue URL
- `stop_timer` — stops the active timer, returns time spent in GitLab format
- `create_time_entry(project_id, task_name, start_time, end_time, task_url?, tags?)` — completed entry for a past range; local ISO times without `Z`
- `list_time_entries(start_date, end_date)` — entries in a `YYYY-MM-DD` range, oldest first, with IDs for updating; each entry carries `note` (null when none) and `has_task` (false = note-only entry; `task_name` falls back to the note)
- `update_time_entry(entry_id, ...optional fields)` — omitted fields keep their values; `tags` replaces all tags; `note` sets the note (empty string clears it); returns the entry's NEW id
- `delete_time_entry(mode?: 'current' | 'last', entry_id?, entry_date?)` — see modes above; `entry_id` deletes a specific stopped entry

## Testing

- Vitest with `nock` for HTTP interception: mock every request a test will trigger BEFORE calling the client method, and call `nock.cleanAll()` in both `beforeEach` and `afterEach`
- Use `vi.useFakeTimers()` + `vi.setSystemTime()` for anything touching elapsed time — `calculateElapsed()` reads the live clock
- Coverage thresholds: 80% lines/functions/branches/statements (v8 provider). `src/index.ts` is deliberately excluded from coverage and has no unit tests — don't add them to raise the score
- Details in `TESTING.md`

## Package Structure

- ESM (`"type": "module"`); package `@guglielmo/tmetric-minimal-mcp` v2.0.0
- Binary: `tmetric-minimal-mcp` → `build/index.js`; only `/build` is published (`files` field); `prepare` script builds on install
- Dependencies: `@modelcontextprotocol/sdk`, `axios`, `date-fns`; dev: vitest (+ coverage-v8, ui), nock, tsx
