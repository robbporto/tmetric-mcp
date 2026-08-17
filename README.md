# TMetric MCP Server

Minimal Model Context Protocol server for TMetric time tracking integration.

## Features

- List TMetric projects
- Start/stop timers
- Check current timer status
- GitLab, GitHub and YouTrack issue integration
- Create time entries for past time ranges
- List and edit past time entries
- Tag support on timers and entries
- Delete time entries

## Installation

```bash
npm install
npm run build
```

## Configuration

Set your TMetric API token:

```bash
export TMETRIC_API_TOKEN="your_token_here"
```

## Usage with Claude Code

Add the TMetric MCP server using the `claude mcp add` command. You can install at different scopes:

### User Scope (Global - All Projects)

Available across all projects for your user:

**One-liner:**
```bash
claude mcp add --scope user tmetric-mcp --env TMETRIC_API_TOKEN=your_token_here -- node /path/to/tmetric-mcp-server/build/index.js
```

**Interactive:**
```bash
claude mcp add tmetric-mcp --scope user
```

When prompted, configure:
- **Command**: `node`
- **Args**: `/path/to/tmetric-mcp-server/build/index.js`
- **Environment variables**: `TMETRIC_API_TOKEN=your_token_here`

### Project Scope (Specific Project)

Available only in the current project directory:

**One-liner:**
```bash
claude mcp add --scope project tmetric-mcp --env TMETRIC_API_TOKEN=your_token_here -- node /path/to/tmetric-mcp-server/build/index.js
```

**Interactive:**
```bash
claude mcp add tmetric-mcp --scope project
```

When prompted, configure with the same settings as above.

### Local Scope (Current Directory)

Available only in the current working directory:

**One-liner:**
```bash
claude mcp add --scope local tmetric-mcp --env TMETRIC_API_TOKEN=your_token_here -- node /path/to/tmetric-mcp-server/build/index.js
```

**Interactive:**
```bash
claude mcp add tmetric-mcp --scope local
```

When prompted, configure with the same settings as above.

### Alternative: Using npx (from GitHub)

You can run directly from GitHub with npx (no clone or build needed):

**One-liner:**
```bash
claude mcp add --scope user tmetric-mcp --env TMETRIC_API_TOKEN=your_token_here -- npx -y github:guglielmo/tmetric-minimal-mcp
```

**Interactive:**
```bash
claude mcp add tmetric-mcp --scope user
```

When prompted, configure:
- **Command**: `npx`
- **Args**: `-y github:guglielmo/tmetric-minimal-mcp`
- **Environment variables**: `TMETRIC_API_TOKEN=your_token_here`

### Alternative: Using npx (from local path)

If you've cloned the repository locally:

**One-liner:**
```bash
claude mcp add --scope user tmetric-mcp --env TMETRIC_API_TOKEN=your_token_here -- npx -y /path/to/tmetric-mcp-server
```

**Interactive:**
```bash
claude mcp add tmetric-mcp --scope user
```

When prompted, configure:
- **Command**: `npx`
- **Args**: `-y /path/to/tmetric-mcp-server`
- **Environment variables**: `TMETRIC_API_TOKEN=your_token_here`

## Available Tools

### list_tmetric_projects()
Get list of available projects.

### get_current_timer()
Check if a timer is running.

### start_timer(project_id, task_name, task_url?, tags?)
Start tracking time on a project/task. `task_url` may be a GitLab, GitHub or
YouTrack issue URL (e.g. `https://example.youtrack.cloud/issue/ABC-123`) and
links the entry to that issue. Fails if a timer is already running.

### stop_timer()
Stop current timer and return time spent.

### create_time_entry(project_id, task_name, start_time, end_time, task_url?, tags?)
Create a completed entry for a past time range. Does not touch the running
timer.

### list_time_entries(start_date, end_date)
List entries between two `YYYY-MM-DD` dates (inclusive), oldest first. Returns
each entry's ID, task name, project, times, duration and tags. Use it to find
an entry ID before updating.

### update_time_entry(entry_id, task_name?, project_id?, start_time?, end_time?, task_url?, tags?)
Change an existing entry. Fields you leave out keep their current values;
`tags` replaces all tags on the entry (an empty array clears them). Entries are
found within a window of 31 days back to 7 days forward from today.

### delete_time_entry(mode?)
Delete a time entry. Mode `"current"` (default) deletes only the running
timer. Mode `"last"` deletes today's most recent entry, but refuses if it was
stopped more than 5 minutes ago.

### Time and date formats

- `start_time` / `end_time` are local ISO date-times **without** a trailing
  `Z`, matching what TMetric returns — e.g. `2024-01-15T09:00:00`.
- `start_date` / `end_date` are plain dates — e.g. `2024-01-15`.

### Tags

Tag names are matched against your TMetric account's existing tags
(case-insensitive). An unknown name returns an error listing the available
tags — tags are never created silently. Only one "work type" tag is allowed
per entry (a TMetric rule).

## Development

```bash
# Watch mode
npm run watch

# Run directly with tsx
npm run dev
```

## Testing

### Running Tests

```bash
# Run all tests once
npm test

# Run tests in watch mode (re-runs on file changes)
npm run test:watch

# Run tests with coverage report
npm run test:coverage

# Run tests with interactive UI
npm run test:ui
```

### Test Coverage

The project has comprehensive test coverage with:
- **96%+ statement coverage** across all modules (thresholds of 80% are enforced)
- Unit tests for all utility functions (`utils.ts`)
- Full integration tests for TMetric API client (`tmetric-client.ts`)
- Mocked HTTP requests using `nock` for reliable testing

See [TESTING.md](TESTING.md) for detailed information about the testing strategy and how to write new tests.

### Manual Testing

Test the MCP server with Claude Code by starting a conversation and using commands like:
- "List my TMetric projects"
- "Start timer on project 12345 for Issue #123: Fix bug"
- "What am I working on?"
- "Stop the timer"

## Troubleshooting

### "TMETRIC_API_TOKEN is required"
Make sure you've set the environment variable with your API token.

### "Failed to initialize TMetric client"
Check that your API token is valid and you have network access to TMetric.

### "Timer already running"
This is expected behavior. Stop the current timer before starting a new one.

## Used By

This MCP server is a dependency for the following Claude Code skills:

- **[issue-time-tracking](../../skills/issue-time-tracking/)** - Automates synchronized issue status tracking and time logging across GitLab/GitHub and TMetric

## License

MIT