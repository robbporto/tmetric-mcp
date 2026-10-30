# Design: Support Deleting Stopped Time Entries

**Date:** 2025-11-09
**Issue:** [#2](https://github.com/guglielmo/tmetric-minimal-mcp/issues/2)
**Status:** Approved

## Problem

Currently, `delete_time_entry` can only delete a running timer. After stopping a timer, attempting to delete it fails with `NO_TIMER_RUNNING` error because the entry is no longer "active" (`endTime !== null`).

**Current workflow failure:**
1. Start timer → Success
2. Stop timer → Success (entry now has `endTime` set)
3. Delete entry → **Fails** - can't find active timer

## Solution Overview

Support two deletion modes:
1. **"current"** - Delete active timer only (existing behavior)
2. **"last"** - Delete most recent entry from today (with 5-minute safety window)

Keep it minimal: no `entry_id` parameter. Users need specific entry management → use TMetric web UI.

## Core Algorithm

### Finding "last entry"
1. Fetch today's time entries: `GET /accounts/{accountId}/timeentries?startDate=today&endDate=today`
2. Sort by `startTime` descending (most recent first)
3. Take the first entry (most recent)
4. Apply 5-minute safety check:
   - If `endTime === null` → Can delete (active timer)
   - If `endTime !== null` → Check if `(now - endTime) <= 5 minutes`
     - Within 5 min → Can delete
     - Beyond 5 min → Return error

### "Current entry" logic (unchanged)
1. Find entry where `endTime === null` from today's entries
2. If found → Delete
3. If not found → Error: "No active timer to delete"

## Implementation Changes

### TMetricClient Changes

**Method signature:**
```typescript
async deleteTimeEntry(mode: 'current' | 'last' = 'current'): Promise<ApiResponse>
```

**New helper method:**
```typescript
private async getLastTimeEntry(): Promise<TMetricTimeEntry | null> {
  await this.ensureInitialized();

  const today = new Date().toISOString().split('T')[0];

  const response = await this.client.get<TMetricTimeEntry[]>(
    `/accounts/${this.accountId}/timeentries`,
    {
      params: {
        startDate: today,
        endDate: today
      }
    }
  );

  // Sort by startTime descending, return most recent
  const sorted = response.data.sort((a, b) =>
    new Date(b.startTime).getTime() - new Date(a.startTime).getTime()
  );

  return sorted[0] || null;
}
```

**Updated deleteTimeEntry() flow:**

```typescript
async deleteTimeEntry(mode: 'current' | 'last' = 'current'): Promise<ApiResponse> {
  try {
    await this.ensureInitialized();

    let targetId: string;
    let entryType: 'active' | 'stopped';
    let stoppedAgo: string | undefined;

    if (mode === 'current') {
      // Existing behavior: only delete active timer
      const current = await this.getCurrentTimer();
      if (!current.is_running) {
        return {
          success: false,
          error: 'NO_TIMER_RUNNING',
          message: 'No active timer to delete'
        };
      }
      targetId = current.timer_id!;
      entryType = 'active';

    } else if (mode === 'last') {
      // New behavior: delete most recent entry with safety check
      const lastEntry = await this.getLastTimeEntry();

      if (!lastEntry) {
        return {
          success: false,
          error: 'NO_ENTRIES_FOUND',
          message: 'No time entries found for today'
        };
      }

      // Check if stopped and how long ago
      if (lastEntry.endTime !== null) {
        const endTime = new Date(lastEntry.endTime);
        const now = new Date();
        const minutesAgo = Math.floor((now.getTime() - endTime.getTime()) / (1000 * 60));

        if (minutesAgo > 5) {
          return {
            success: false,
            error: 'ENTRY_TOO_OLD',
            message: `Last entry stopped ${minutesAgo} minutes ago. Use TMetric web UI to delete specific entries.`
          };
        }

        entryType = 'stopped';
        stoppedAgo = `${minutesAgo}m`;
      } else {
        entryType = 'active';
      }

      targetId = lastEntry.id;
    }

    // Perform deletion
    await this.client.delete(
      `/accounts/${this.accountId}/timeentries/${targetId}`
    );

    return {
      success: true,
      deleted: targetId,
      entry_type: entryType,
      stopped_ago: stoppedAgo
    };

  } catch (error: any) {
    return {
      success: false,
      error: 'API_ERROR',
      message: `Failed to delete entry: ${error.message}`
    };
  }
}
```

### MCP Tool Changes (index.ts)

Update the tool definition:

```typescript
{
  name: "delete_time_entry",
  description: "Delete a time entry. Mode 'current' deletes active timer only, 'last' deletes most recent entry (with 5-min safety window)",
  inputSchema: {
    type: "object",
    properties: {
      mode: {
        type: "string",
        enum: ["current", "last"],
        description: "Deletion mode: 'current' for active timer only, 'last' for most recent entry",
        default: "current"
      }
    }
  }
}
```

Update the handler:

```typescript
case "delete_time_entry": {
  const mode = args.mode as 'current' | 'last' | undefined;
  const result = await client.deleteTimeEntry(mode);
  return {
    content: [{ type: "text", text: JSON.stringify(result, null, 2) }]
  };
}
```

## Error Handling

| Scenario | Error Code | Message |
|----------|------------|---------|
| Mode: "current", no active timer | `NO_TIMER_RUNNING` | "No active timer to delete" |
| Mode: "last", no entries today | `NO_ENTRIES_FOUND` | "No time entries found for today" |
| Mode: "last", entry too old | `ENTRY_TOO_OLD` | "Last entry stopped more than 5 minutes ago. Use TMetric web UI to delete specific entries." |
| API deletion fails | `API_ERROR` | "Failed to delete entry: {details}" |

## Success Response

```typescript
{
  success: true,
  deleted: string,           // Entry ID that was deleted
  entry_type: "active" | "stopped",
  stopped_ago?: string       // e.g., "2m" (only for stopped entries)
}
```

## Edge Cases

- **Multiple entries today**: "last" mode takes most recent by `startTime`
- **Timezone handling**: Use same timezone logic as existing code
- **Concurrent operations**: Race condition possible but acceptable (user would retry)
- **Empty day**: Clear error message guides user
- **Exactly 5 minutes**: Boundary condition - delete if `<= 5 minutes`

## Testing Considerations

1. Test "current" mode with active timer
2. Test "current" mode without active timer
3. Test "last" mode with active timer
4. Test "last" mode with recently stopped entry (< 5 min)
5. Test "last" mode with old stopped entry (> 5 min)
6. Test "last" mode with no entries today
7. Test with multiple entries (verify most recent is selected)

## Implementation Checklist

- [ ] Add `getLastTimeEntry()` helper method to TMetricClient
- [ ] Update `deleteTimeEntry()` signature to accept mode parameter
- [ ] Implement mode-based logic in `deleteTimeEntry()`
- [ ] Update MCP tool schema in index.ts
- [ ] Update MCP tool handler in index.ts
- [ ] Add tests for all scenarios
- [ ] Update README documentation
- [ ] Update CLAUDE.md with new behavior

## Update 2026-10-30

Delete by `entry_id` (with optional `entry_date`) was added to `delete_time_entry` at the user's request, superseding the earlier decision that specific-entry management belongs in the TMetric web UI. Running entries are refused with `ENTRY_RUNNING`. The 5-minute rule still applies to mode `"last"`.
