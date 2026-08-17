import axios, { AxiosInstance } from 'axios';
import type {
  TMetricProject,
  TMetricTag,
  TMetricTimeEntry,
  TMetricUser,
  TimerInfo,
  ApiResponse
} from './types.js';
import {
  calculateElapsed,
  calculateDurationMinutes,
  formatMinutesToGitLab,
  parseIssueUrl
} from './utils.js';

export class TMetricClient {
  private client: AxiosInstance;
  private accountId: string | null = null;

  constructor(apiToken: string) {
    this.client = axios.create({
      baseURL: 'https://app.tmetric.com/api/v3',
      headers: {
        'Authorization': `Bearer ${apiToken}`,
        'Content-Type': 'application/json'
      }
    });
  }

  /**
   * Initialize client by fetching user info and caching account ID
   */
  async initialize(): Promise<void> {
    try {
      const response = await this.client.get<TMetricUser>('/user');
      this.accountId = response.data.activeAccountId;
    } catch (error: any) {
      throw new Error(`Failed to initialize TMetric client: ${error.message}`);
    }
  }

  /**
   * Ensure client is initialized
   */
  private async ensureInitialized(): Promise<void> {
    if (!this.accountId) {
      await this.initialize();
    }
  }

  /**
   * Resolve tag names against the account's tag list.
   * Tags must exist already (no silent tag creation), matching is
   * case-insensitive, and only one work-type tag is allowed per entry.
   */
  private async resolveTags(
    tagNames: string[]
  ): Promise<{ ok: true; tags: TMetricTag[] } | { ok: false; response: ApiResponse }> {
    if (tagNames.length === 0) {
      return { ok: true, tags: [] };
    }

    const response = await this.client.get<TMetricTag[]>(
      `/accounts/${this.accountId}/timeentries/tags`
    );
    const accountTags = response.data;

    const resolved: TMetricTag[] = [];
    const unknown: string[] = [];

    for (const name of tagNames) {
      const match = accountTags.find(
        tag => tag.name?.toLowerCase() === name.trim().toLowerCase()
      );
      if (match) {
        resolved.push({
          id: match.id,
          name: match.name,
          isWorkType: match.isWorkType ?? false
        });
      } else {
        unknown.push(name);
      }
    }

    if (unknown.length > 0) {
      const available = accountTags.map(tag => tag.name).filter(Boolean).join(', ');
      return {
        ok: false,
        response: {
          success: false,
          error: 'UNKNOWN_TAG',
          message: `Unknown tag(s): ${unknown.join(', ')}. Available tags: ${available || '(none)'}`
        }
      };
    }

    const workTypes = resolved.filter(tag => tag.isWorkType);
    if (workTypes.length > 1) {
      return {
        ok: false,
        response: {
          success: false,
          error: 'INVALID_TAGS',
          message: `A time entry can have only one work type tag; got: ${workTypes.map(tag => tag.name).join(', ')}`
        }
      };
    }

    return { ok: true, tags: resolved };
  }

  /**
   * POST /timeentries may return a single entry or, per the API spec, all
   * entries for the affected days. Pick the one we just created.
   */
  private pickCreatedEntry(
    data: TMetricTimeEntry | TMetricTimeEntry[],
    isCreated: (entry: TMetricTimeEntry) => boolean
  ): TMetricTimeEntry {
    if (!Array.isArray(data)) {
      return data;
    }
    return data.find(isCreated) ?? data[data.length - 1];
  }

  /**
   * Get list of projects
   */
  async listProjects(): Promise<ApiResponse> {
    try {
      await this.ensureInitialized();

      const response = await this.client.get<TMetricProject[]>(
        `/accounts/${this.accountId}/timeentries/projects`
      );

      return {
        success: true,
        projects: response.data.map(p => ({
          id: p.id,
          name: p.name
        }))
      };
    } catch (error: any) {
      return {
        success: false,
        error: 'API_ERROR',
        message: `Failed to list projects: ${error.message}`
      };
    }
  }

  /**
   * Get active time entry (full object) from today's entries
   */
  private async getActiveTimeEntry(): Promise<TMetricTimeEntry | null> {
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

    // Find entry with no endTime (active timer)
    return response.data.find(entry => entry.endTime === null) || null;
  }

  /**
   * Get last time entry (most recent) from today's entries
   */
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

    if (response.data.length === 0) {
      return null;
    }

    // Sort by startTime descending, return most recent
    const sorted = response.data.sort((a, b) =>
      new Date(b.startTime).getTime() - new Date(a.startTime).getTime()
    );

    return sorted[0];
  }

  /**
   * Get current running timer by querying today's time entries
   */
  async getCurrentTimer(): Promise<TimerInfo> {
    try {
      const activeEntry = await this.getActiveTimeEntry();

      if (!activeEntry) {
        return { is_running: false };
      }

      // Task name comes from either task.name or note field
      const taskName = activeEntry.task?.name || activeEntry.note || 'No description';

      return {
        is_running: true,
        timer_id: activeEntry.id,
        task_name: taskName,
        task_url: activeEntry.task?.externalLink?.link,
        project_name: activeEntry.project?.name || 'No project',
        project_id: activeEntry.project?.id,
        started_at: activeEntry.startTime,
        elapsed: calculateElapsed(activeEntry.startTime)
      };
    } catch (error: any) {
      throw new Error(`Failed to get current timer: ${error.message}`);
    }
  }

  /**
   * Start a new timer
   */
  async startTimer(
    projectId: number,
    taskName: string,
    taskUrl?: string,
    tags?: string[]
  ): Promise<ApiResponse> {
    try {
      await this.ensureInitialized();

      // CRITICAL: Check if timer already running
      const current = await this.getCurrentTimer();
      if (current.is_running) {
        return {
          success: false,
          error: 'TIMER_ALREADY_RUNNING',
          message: 'Cannot start new timer. A timer is already running.',
          current_timer: current
        };
      }

      const resolvedTags = await this.resolveTags(tags || []);
      if (!resolvedTags.ok) {
        return resolvedTags.response;
      }

      // Build task object
      const task: any = { name: taskName };

      // Add integration (GitLab, GitHub or YouTrack) if task URL provided
      if (taskUrl) {
        const parsed = parseIssueUrl(taskUrl);

        if (parsed) {
          task.externalLink = {
            link: taskUrl,
            issueId: parsed.issueId
          };
          task.integration = {
            url: parsed.baseUrl,
            type: parsed.integrationType
          };
        }
      }

      // Create time entry with startTime: null (means "now")
      const entryData = {
        startTime: null,
        endTime: null,
        project: { id: projectId },
        task,
        tags: resolvedTags.tags
      };

      const response = await this.client.post<TMetricTimeEntry | TMetricTimeEntry[]>(
        `/accounts/${this.accountId}/timeentries`,
        entryData
      );

      const created = this.pickCreatedEntry(response.data, e => e.endTime === null);

      return {
        success: true,
        timer_id: created.id,
        started_at: created.startTime,
        task_name: taskName
      };
    } catch (error: any) {
      return {
        success: false,
        error: 'API_ERROR',
        message: `Failed to start timer: ${error.message}`
      };
    }
  }

  /**
   * Create a completed time entry for a past time range.
   * Times are local ISO strings without a trailing "Z" (matching TMetric's format).
   */
  async createTimeEntry(
    projectId: number,
    taskName: string,
    startTime: string,
    endTime: string,
    taskUrl?: string,
    tags?: string[]
  ): Promise<ApiResponse> {
    try {
      const start = new Date(startTime);
      const end = new Date(endTime);

      if (isNaN(start.getTime()) || isNaN(end.getTime())) {
        return {
          success: false,
          error: 'INVALID_TIME_FORMAT',
          message: 'start_time and end_time must be ISO date-time strings (e.g. "2024-01-15T09:00:00")'
        };
      }

      if (end.getTime() <= start.getTime()) {
        return {
          success: false,
          error: 'INVALID_TIME_RANGE',
          message: 'end_time must be after start_time'
        };
      }

      await this.ensureInitialized();

      const resolvedTags = await this.resolveTags(tags || []);
      if (!resolvedTags.ok) {
        return resolvedTags.response;
      }

      // Build task object (same issue-URL handling as startTimer)
      const task: any = { name: taskName };

      if (taskUrl) {
        const parsed = parseIssueUrl(taskUrl);

        if (parsed) {
          task.externalLink = {
            link: taskUrl,
            issueId: parsed.issueId
          };
          task.integration = {
            url: parsed.baseUrl,
            type: parsed.integrationType
          };
        }
      }

      const entryData = {
        startTime,
        endTime,
        project: { id: projectId },
        task,
        tags: resolvedTags.tags
      };

      const response = await this.client.post<TMetricTimeEntry | TMetricTimeEntry[]>(
        `/accounts/${this.accountId}/timeentries`,
        entryData
      );

      const created = this.pickCreatedEntry(
        response.data,
        e => new Date(e.startTime).getTime() === start.getTime()
      );

      const durationMinutes = calculateDurationMinutes(startTime, endTime);

      return {
        success: true,
        entry_id: created.id,
        task_name: taskName,
        started_at: startTime,
        ended_at: endTime,
        time_spent: formatMinutesToGitLab(durationMinutes),
        time_spent_minutes: durationMinutes
      };
    } catch (error: any) {
      return {
        success: false,
        error: 'API_ERROR',
        message: `Failed to create time entry: ${error.message}`
      };
    }
  }

  /**
   * Stop the current timer
   */
  async stopTimer(): Promise<ApiResponse> {
    try {
      await this.ensureInitialized();

      // Get active time entry (full object)
      const activeEntry = await this.getActiveTimeEntry();

      if (!activeEntry) {
        return {
          success: false,
          error: 'NO_TIMER_RUNNING',
          message: 'No active timer to stop'
        };
      }

      const timerId = activeEntry.id;
      const startTime = activeEntry.startTime;

      // Set endTime to now in local timezone (matching startTime format)
      const now = new Date();
      const endTime = new Date(now.getTime() - (now.getTimezoneOffset() * 60000))
        .toISOString()
        .slice(0, -1); // Remove Z suffix

      // Build clean request body with only necessary fields
      const updateData: any = {
        startTime: startTime,
        endTime: endTime,
        project: {
          id: activeEntry.project?.id
        },
        tags: activeEntry.tags || []
      };

      // Include task if present (with name), otherwise use note
      if (activeEntry.task && activeEntry.task.name) {
        updateData.task = {
          name: activeEntry.task.name
        };

        // Add external link if present
        if (activeEntry.task.externalLink) {
          updateData.task.externalLink = activeEntry.task.externalLink;
        }

        // Add integration if present
        if (activeEntry.task.integration) {
          updateData.task.integration = activeEntry.task.integration;
        }
      } else if (activeEntry.note) {
        updateData.note = activeEntry.note;
      }

      // Update entry with PUT
      await this.client.put(
        `/accounts/${this.accountId}/timeentries/${timerId}`,
        updateData
      );

      // Calculate duration
      const durationMinutes = calculateDurationMinutes(startTime, endTime);

      return {
        success: true,
        time_spent: formatMinutesToGitLab(durationMinutes),
        time_spent_minutes: durationMinutes,
        started_at: startTime,
        ended_at: endTime,
        task_name: activeEntry.task?.name || 'Unknown task'
      };
    } catch (error: any) {
      return {
        success: false,
        error: 'API_ERROR',
        message: `Failed to stop timer: ${error.message}`
      };
    }
  }

  /**
   * List time entries in a date range (inclusive), oldest first.
   * Dates are YYYY-MM-DD strings.
   */
  async listTimeEntries(startDate: string, endDate: string): Promise<ApiResponse> {
    try {
      const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

      if (!DATE_PATTERN.test(startDate) || !DATE_PATTERN.test(endDate)) {
        return {
          success: false,
          error: 'INVALID_DATE_FORMAT',
          message: 'start_date and end_date must be YYYY-MM-DD strings'
        };
      }

      if (endDate < startDate) {
        return {
          success: false,
          error: 'INVALID_DATE_RANGE',
          message: 'end_date must be the same as or after start_date'
        };
      }

      await this.ensureInitialized();

      const response = await this.client.get<TMetricTimeEntry[]>(
        `/accounts/${this.accountId}/timeentries`,
        {
          params: {
            startDate,
            endDate
          }
        }
      );

      const entries = response.data
        .slice()
        .sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime())
        .map(entry => ({
          id: entry.id,
          task_name: entry.task?.name || entry.note || 'No description',
          project_name: entry.project?.name || 'No project',
          project_id: entry.project?.id,
          start_time: entry.startTime,
          end_time: entry.endTime,
          is_running: entry.endTime === null,
          duration_minutes: entry.endTime === null
            ? null
            : calculateDurationMinutes(entry.startTime, entry.endTime),
          task_url: entry.task?.externalLink?.link,
          tags: (entry.tags || []).map(tag => tag.name).filter(Boolean)
        }));

      return {
        success: true,
        entries
      };
    } catch (error: any) {
      return {
        success: false,
        error: 'API_ERROR',
        message: `Failed to list time entries: ${error.message}`
      };
    }
  }

  /**
   * Update an existing time entry.
   * The API has no single-entry GET, so the entry is found by scanning a
   * date window (31 days back to 7 days forward). The PUT re-sends the full
   * merged body, which is safe whether the API replaces or patches.
   */
  async updateTimeEntry(
    entryId: string,
    updates: {
      taskName?: string;
      projectId?: number;
      startTime?: string;
      endTime?: string;
      taskUrl?: string;
      tags?: string[];
    }
  ): Promise<ApiResponse> {
    try {
      const { taskName, projectId, startTime, endTime, taskUrl, tags } = updates;

      if (
        taskName === undefined &&
        projectId === undefined &&
        startTime === undefined &&
        endTime === undefined &&
        taskUrl === undefined &&
        tags === undefined
      ) {
        return {
          success: false,
          error: 'NO_UPDATES',
          message: 'Provide at least one field to update'
        };
      }

      for (const time of [startTime, endTime]) {
        if (time !== undefined && isNaN(new Date(time).getTime())) {
          return {
            success: false,
            error: 'INVALID_TIME_FORMAT',
            message: 'start_time and end_time must be ISO date-time strings (e.g. "2024-01-15T09:00:00")'
          };
        }
      }

      let parsedUrl = null;
      if (taskUrl !== undefined) {
        parsedUrl = parseIssueUrl(taskUrl);
        if (!parsedUrl) {
          return {
            success: false,
            error: 'INVALID_TASK_URL',
            message: 'task_url must be a GitLab, GitHub or YouTrack issue URL'
          };
        }
      }

      await this.ensureInitialized();

      // Find the entry: no GET-by-id in the API, so scan a date window
      const now = new Date();
      const searchStart = new Date(now.getTime() - 31 * 86400000).toISOString().split('T')[0];
      const searchEnd = new Date(now.getTime() + 7 * 86400000).toISOString().split('T')[0];

      const response = await this.client.get<TMetricTimeEntry[]>(
        `/accounts/${this.accountId}/timeentries`,
        {
          params: {
            startDate: searchStart,
            endDate: searchEnd
          }
        }
      );

      const entry = response.data.find(e => e.id === entryId);

      if (!entry) {
        return {
          success: false,
          error: 'ENTRY_NOT_FOUND',
          message: `Entry ${entryId} not found between ${searchStart} and ${searchEnd}. Use list_time_entries to find entry IDs.`
        };
      }

      // Merge: new values win, everything else keeps the fetched value
      const mergedStart = startTime ?? entry.startTime;
      const mergedEnd = endTime ?? entry.endTime;

      if (mergedEnd !== null && new Date(mergedEnd).getTime() <= new Date(mergedStart).getTime()) {
        return {
          success: false,
          error: 'INVALID_TIME_RANGE',
          message: 'end_time must be after start_time'
        };
      }

      // tags provided (even []) replaces the entry's tags; omitted keeps them
      let mergedTags: TMetricTag[] = entry.tags || [];
      if (tags !== undefined) {
        const resolvedTags = await this.resolveTags(tags);
        if (!resolvedTags.ok) {
          return resolvedTags.response;
        }
        mergedTags = resolvedTags.tags;
      }

      const updateData: any = {
        startTime: mergedStart,
        endTime: mergedEnd,
        project: {
          id: projectId ?? entry.project?.id
        },
        tags: mergedTags
      };

      const mergedTaskName = taskName ?? entry.task?.name;

      if (mergedTaskName) {
        updateData.task = { name: mergedTaskName };

        if (parsedUrl && taskUrl) {
          updateData.task.externalLink = {
            link: taskUrl,
            issueId: parsedUrl.issueId
          };
          updateData.task.integration = {
            url: parsedUrl.baseUrl,
            type: parsedUrl.integrationType
          };
        } else {
          if (entry.task?.externalLink) {
            updateData.task.externalLink = entry.task.externalLink;
          }
          if (entry.task?.integration) {
            updateData.task.integration = entry.task.integration;
          }
        }
      } else if (entry.note) {
        updateData.note = entry.note;
      }

      await this.client.put(
        `/accounts/${this.accountId}/timeentries/${entryId}`,
        updateData
      );

      const result: ApiResponse = {
        success: true,
        entry_id: entryId,
        task_name: mergedTaskName || entry.note || 'No description',
        started_at: mergedStart,
        ended_at: mergedEnd
      };

      if (mergedEnd !== null) {
        const durationMinutes = calculateDurationMinutes(mergedStart, mergedEnd);
        result.time_spent = formatMinutesToGitLab(durationMinutes);
        result.time_spent_minutes = durationMinutes;
      }

      return result;
    } catch (error: any) {
      return {
        success: false,
        error: 'API_ERROR',
        message: `Failed to update time entry: ${error.message}`
      };
    }
  }

  /**
   * Delete a time entry
   */
  async deleteTimeEntry(mode: 'current' | 'last' = 'current'): Promise<ApiResponse> {
    try {
      await this.ensureInitialized();

      let targetId: string | undefined;
      let entryType: 'active' | 'stopped' | undefined;
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

      // This should never happen due to mode type constraint, but TypeScript needs it
      if (!targetId || !entryType) {
        return {
          success: false,
          error: 'INVALID_MODE',
          message: 'Invalid deletion mode'
        };
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
}
