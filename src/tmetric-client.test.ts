import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import nock from 'nock';
import { TMetricClient } from './tmetric-client.js';
import type { TMetricUser, TMetricProject, TMetricTimeEntry } from './types.js';

const TMETRIC_BASE_URL = 'https://app.tmetric.com';
const API_TOKEN = 'test-api-token';
const ACCOUNT_ID = 'test-account-123';

describe('TMetricClient', () => {
  let client: TMetricClient;

  beforeEach(() => {
    client = new TMetricClient(API_TOKEN);
    nock.cleanAll();

    // Mock current time for consistent elapsed time calculations
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2024-01-15T12:00:00Z'));
  });

  afterEach(() => {
    nock.cleanAll();
    vi.useRealTimers();
  });

  describe('initialize', () => {
    it('should fetch and cache account ID', async () => {
      const mockUser: TMetricUser = {
        activeAccountId: ACCOUNT_ID,
        email: 'test@example.com',
        name: 'Test User',
      };

      nock(TMETRIC_BASE_URL)
        .get('/api/v3/user')
        .reply(200, mockUser);

      await client.initialize();

      // Verify the account ID was cached by making another call
      nock(TMETRIC_BASE_URL)
        .get(`/api/v3/accounts/${ACCOUNT_ID}/timeentries/projects`)
        .reply(200, []);

      const result = await client.listProjects();
      expect(result.success).toBe(true);
    });

    it('should throw error when API call fails', async () => {
      nock(TMETRIC_BASE_URL)
        .get('/api/v3/user')
        .reply(401, { error: 'Unauthorized' });

      await expect(client.initialize()).rejects.toThrow(
        'Failed to initialize TMetric client'
      );
    });

    it('should throw error when network fails', async () => {
      nock(TMETRIC_BASE_URL)
        .get('/api/v3/user')
        .replyWithError('Network error');

      await expect(client.initialize()).rejects.toThrow(
        'Failed to initialize TMetric client'
      );
    });
  });

  describe('listProjects', () => {
    beforeEach(async () => {
      // Initialize client before each test
      nock(TMETRIC_BASE_URL)
        .get('/api/v3/user')
        .reply(200, { activeAccountId: ACCOUNT_ID });

      await client.initialize();
    });

    it('should return list of projects', async () => {
      const mockProjects: TMetricProject[] = [
        { id: 1, name: 'Project One' },
        { id: 2, name: 'Project Two' },
      ];

      nock(TMETRIC_BASE_URL)
        .get(`/api/v3/accounts/${ACCOUNT_ID}/timeentries/projects`)
        .reply(200, mockProjects);

      const result = await client.listProjects();

      expect(result.success).toBe(true);
      expect(result.projects).toEqual([
        { id: 1, name: 'Project One' },
        { id: 2, name: 'Project Two' },
      ]);
    });

    it('should return empty array when no projects', async () => {
      nock(TMETRIC_BASE_URL)
        .get(`/api/v3/accounts/${ACCOUNT_ID}/timeentries/projects`)
        .reply(200, []);

      const result = await client.listProjects();

      expect(result.success).toBe(true);
      expect(result.projects).toEqual([]);
    });

    it('should handle API errors gracefully', async () => {
      nock(TMETRIC_BASE_URL)
        .get(`/api/v3/accounts/${ACCOUNT_ID}/timeentries/projects`)
        .reply(500, { error: 'Internal Server Error' });

      const result = await client.listProjects();

      expect(result.success).toBe(false);
      expect(result.error).toBe('API_ERROR');
      expect(result.message).toContain('Failed to list projects');
    });

    it('should auto-initialize if not already initialized', async () => {
      const newClient = new TMetricClient(API_TOKEN);

      nock(TMETRIC_BASE_URL)
        .get('/api/v3/user')
        .reply(200, { activeAccountId: ACCOUNT_ID });

      nock(TMETRIC_BASE_URL)
        .get(`/api/v3/accounts/${ACCOUNT_ID}/timeentries/projects`)
        .reply(200, [{ id: 1, name: 'Test' }]);

      const result = await newClient.listProjects();

      expect(result.success).toBe(true);
    });
  });

  describe('getCurrentTimer', () => {
    beforeEach(async () => {
      nock(TMETRIC_BASE_URL)
        .get('/api/v3/user')
        .reply(200, { activeAccountId: ACCOUNT_ID });

      await client.initialize();
    });

    it('should return timer info when timer is running', async () => {
      const mockEntries: TMetricTimeEntry[] = [
        {
          id: 'entry-1',
          startTime: '2024-01-15T10:00:00Z',
          endTime: null, // Active timer
          project: { id: 123, name: 'Test Project' },
          task: {
            name: 'Test Task',
            externalLink: {
              link: 'https://gitlab.com/test/repo/-/issues/42',
              issueId: 'Gitlab Issue: #42',
            },
          },
        },
      ];

      nock(TMETRIC_BASE_URL)
        .get(`/api/v3/accounts/${ACCOUNT_ID}/timeentries`)
        .query({ startDate: '2024-01-15', endDate: '2024-01-15' })
        .reply(200, mockEntries);

      const result = await client.getCurrentTimer();

      expect(result.is_running).toBe(true);
      expect(result.timer_id).toBe('entry-1');
      expect(result.task_name).toBe('Test Task');
      expect(result.task_url).toBe('https://gitlab.com/test/repo/-/issues/42');
      expect(result.project_name).toBe('Test Project');
      expect(result.project_id).toBe(123);
      expect(result.started_at).toBe('2024-01-15T10:00:00Z');
      expect(result.elapsed).toBe('2h 0m'); // 2 hours from 10:00 to 12:00
    });

    it('should return not running when no active timer', async () => {
      const mockEntries: TMetricTimeEntry[] = [
        {
          id: 'entry-1',
          startTime: '2024-01-15T10:00:00Z',
          endTime: '2024-01-15T11:00:00Z', // Completed
          project: { id: 123, name: 'Test Project' },
        },
      ];

      nock(TMETRIC_BASE_URL)
        .get(`/api/v3/accounts/${ACCOUNT_ID}/timeentries`)
        .query({ startDate: '2024-01-15', endDate: '2024-01-15' })
        .reply(200, mockEntries);

      const result = await client.getCurrentTimer();

      expect(result.is_running).toBe(false);
      expect(result.timer_id).toBeUndefined();
    });

    it('should return not running when no entries today', async () => {
      nock(TMETRIC_BASE_URL)
        .get(`/api/v3/accounts/${ACCOUNT_ID}/timeentries`)
        .query({ startDate: '2024-01-15', endDate: '2024-01-15' })
        .reply(200, []);

      const result = await client.getCurrentTimer();

      expect(result.is_running).toBe(false);
    });

    it('should handle task without external link', async () => {
      const mockEntries: TMetricTimeEntry[] = [
        {
          id: 'entry-1',
          startTime: '2024-01-15T10:00:00Z',
          endTime: null,
          project: { id: 123, name: 'Test Project' },
          task: { name: 'Simple Task' },
        },
      ];

      nock(TMETRIC_BASE_URL)
        .get(`/api/v3/accounts/${ACCOUNT_ID}/timeentries`)
        .query({ startDate: '2024-01-15', endDate: '2024-01-15' })
        .reply(200, mockEntries);

      const result = await client.getCurrentTimer();

      expect(result.is_running).toBe(true);
      expect(result.task_url).toBeUndefined();
    });

    it('should handle entry without task', async () => {
      const mockEntries: TMetricTimeEntry[] = [
        {
          id: 'entry-1',
          startTime: '2024-01-15T10:00:00Z',
          endTime: null,
          project: { id: 123, name: 'Test Project' },
        },
      ];

      nock(TMETRIC_BASE_URL)
        .get(`/api/v3/accounts/${ACCOUNT_ID}/timeentries`)
        .query({ startDate: '2024-01-15', endDate: '2024-01-15' })
        .reply(200, mockEntries);

      const result = await client.getCurrentTimer();

      expect(result.is_running).toBe(true);
      expect(result.task_name).toBe('No description');
    });

    it('should throw error on API failure', async () => {
      nock(TMETRIC_BASE_URL)
        .get(`/api/v3/accounts/${ACCOUNT_ID}/timeentries`)
        .query({ startDate: '2024-01-15', endDate: '2024-01-15' })
        .reply(500, { error: 'Server error' });

      await expect(client.getCurrentTimer()).rejects.toThrow(
        'Failed to get current timer'
      );
    });
  });

  describe('startTimer', () => {
    beforeEach(async () => {
      nock(TMETRIC_BASE_URL)
        .get('/api/v3/user')
        .reply(200, { activeAccountId: ACCOUNT_ID });

      await client.initialize();
    });

    it('should start a new timer without GitLab URL', async () => {
      // Mock getCurrentTimer to return no running timer
      nock(TMETRIC_BASE_URL)
        .get(`/api/v3/accounts/${ACCOUNT_ID}/timeentries`)
        .query({ startDate: '2024-01-15', endDate: '2024-01-15' })
        .reply(200, []);

      const mockResponse: TMetricTimeEntry = {
        id: 'new-entry',
        startTime: '2024-01-15T12:00:00Z',
        endTime: null,
        project: { id: 123, name: 'Test Project' },
        task: { name: 'New Task' },
      };

      nock(TMETRIC_BASE_URL)
        .post(`/api/v3/accounts/${ACCOUNT_ID}/timeentries`, (body) => {
          expect(body.project.id).toBe(123);
          expect(body.task.name).toBe('New Task');
          expect(body.startTime).toBeNull();
          expect(body.endTime).toBeNull();
          return true;
        })
        .reply(200, mockResponse);

      const result = await client.startTimer(123, 'New Task');

      expect(result.success).toBe(true);
      expect(result.timer_id).toBe('new-entry');
      expect(result.task_name).toBe('New Task');
      expect(result.started_at).toBe('2024-01-15T12:00:00Z');
    });

    it('should start a new timer with GitLab URL', async () => {
      nock(TMETRIC_BASE_URL)
        .get(`/api/v3/accounts/${ACCOUNT_ID}/timeentries`)
        .query({ startDate: '2024-01-15', endDate: '2024-01-15' })
        .reply(200, []);

      const mockResponse: TMetricTimeEntry = {
        id: 'new-entry',
        startTime: '2024-01-15T12:00:00Z',
        endTime: null,
        project: { id: 123, name: 'Test Project' },
        task: {
          name: 'Issue #42: Fix bug',
          externalLink: {
            link: 'https://gitlab.openpolis.io/test/repo/-/issues/42',
            issueId: 'GitLab Issue: #42',
          },
          integration: {
            url: 'https://gitlab.openpolis.io',
            type: 'GitLab',
          },
        },
      };

      nock(TMETRIC_BASE_URL)
        .post(`/api/v3/accounts/${ACCOUNT_ID}/timeentries`, (body) => {
          expect(body.task.externalLink.link).toBe(
            'https://gitlab.openpolis.io/test/repo/-/issues/42'
          );
          expect(body.task.externalLink.issueId).toBe('GitLab Issue: #42');
          expect(body.task.integration.url).toBe('https://gitlab.openpolis.io');
          expect(body.task.integration.type).toBe('GitLab');
          return true;
        })
        .reply(200, mockResponse);

      const result = await client.startTimer(
        123,
        'Issue #42: Fix bug',
        'https://gitlab.openpolis.io/test/repo/-/issues/42'
      );

      expect(result.success).toBe(true);
      expect(result.timer_id).toBe('new-entry');
    });

    it('should start a new timer with YouTrack URL', async () => {
      nock(TMETRIC_BASE_URL)
        .get(`/api/v3/accounts/${ACCOUNT_ID}/timeentries`)
        .query({ startDate: '2024-01-15', endDate: '2024-01-15' })
        .reply(200, []);

      const mockResponse: TMetricTimeEntry = {
        id: 'new-entry',
        startTime: '2024-01-15T12:00:00Z',
        endTime: null,
        project: { id: 123, name: 'Test Project' },
        task: {
          name: 'ABC-123 Fix the widget',
          externalLink: {
            link: 'https://example.youtrack.cloud/issue/ABC-123',
            issueId: 'ABC-123',
          },
          integration: {
            url: 'https://example.youtrack.cloud',
            type: 'YouTrack',
          },
        },
      };

      nock(TMETRIC_BASE_URL)
        .post(`/api/v3/accounts/${ACCOUNT_ID}/timeentries`, (body) => {
          expect(body.task.externalLink.link).toBe(
            'https://example.youtrack.cloud/issue/ABC-123'
          );
          expect(body.task.externalLink.issueId).toBe('ABC-123');
          expect(body.task.integration.url).toBe('https://example.youtrack.cloud');
          expect(body.task.integration.type).toBe('YouTrack');
          return true;
        })
        .reply(200, mockResponse);

      const result = await client.startTimer(
        123,
        'ABC-123 Fix the widget',
        'https://example.youtrack.cloud/issue/ABC-123'
      );

      expect(result.success).toBe(true);
      expect(result.timer_id).toBe('new-entry');
    });

    it('should resolve tag names and send tag objects', async () => {
      nock(TMETRIC_BASE_URL)
        .get(`/api/v3/accounts/${ACCOUNT_ID}/timeentries`)
        .query({ startDate: '2024-01-15', endDate: '2024-01-15' })
        .reply(200, []);

      nock(TMETRIC_BASE_URL)
        .get(`/api/v3/accounts/${ACCOUNT_ID}/timeentries/tags`)
        .reply(200, [
          { id: 1, name: 'Development', isWorkType: false },
          { id: 2, name: 'Research', isWorkType: true },
        ]);

      nock(TMETRIC_BASE_URL)
        .post(`/api/v3/accounts/${ACCOUNT_ID}/timeentries`, (body) => {
          expect(body.tags).toEqual([
            { id: 1, name: 'Development', isWorkType: false },
          ]);
          return true;
        })
        .reply(200, {
          id: 'new-entry',
          startTime: '2024-01-15T12:00:00',
          endTime: null,
          project: { id: 123, name: 'Test Project' },
          task: { name: 'Task' },
        });

      // Matching is case-insensitive
      const result = await client.startTimer(123, 'Task', undefined, ['development']);

      expect(result.success).toBe(true);
    });

    it('should fail with UNKNOWN_TAG for a tag not in the account', async () => {
      nock(TMETRIC_BASE_URL)
        .get(`/api/v3/accounts/${ACCOUNT_ID}/timeentries`)
        .query({ startDate: '2024-01-15', endDate: '2024-01-15' })
        .reply(200, []);

      nock(TMETRIC_BASE_URL)
        .get(`/api/v3/accounts/${ACCOUNT_ID}/timeentries/tags`)
        .reply(200, [{ id: 1, name: 'Development', isWorkType: false }]);

      const result = await client.startTimer(123, 'Task', undefined, ['Nonexistent']);

      expect(result.success).toBe(false);
      expect(result.error).toBe('UNKNOWN_TAG');
      expect(result.message).toContain('Nonexistent');
      expect(result.message).toContain('Development');
    });

    it('should match tag names with stray spaces and collapse duplicates', async () => {
      nock(TMETRIC_BASE_URL)
        .get(`/api/v3/accounts/${ACCOUNT_ID}/timeentries`)
        .query({ startDate: '2024-01-15', endDate: '2024-01-15' })
        .reply(200, []);

      // Account tag stored with a trailing space
      nock(TMETRIC_BASE_URL)
        .get(`/api/v3/accounts/${ACCOUNT_ID}/timeentries/tags`)
        .reply(200, [{ id: 1, name: 'Development ', isWorkType: false }]);

      nock(TMETRIC_BASE_URL)
        .post(`/api/v3/accounts/${ACCOUNT_ID}/timeentries`, (body) => {
          expect(body.tags).toHaveLength(1);
          expect(body.tags[0].id).toBe(1);
          return true;
        })
        .reply(200, {
          id: 'new-entry',
          startTime: '2024-01-15T12:00:00',
          endTime: null,
          project: { id: 123, name: 'Test Project' },
          task: { name: 'Task' },
        });

      // Same tag twice with different casing resolves to one object
      const result = await client.startTimer(123, 'Task', undefined, [
        'development',
        'Development',
      ]);

      expect(result.success).toBe(true);
    });

    it('should fail when more than one work type tag is requested', async () => {
      nock(TMETRIC_BASE_URL)
        .get(`/api/v3/accounts/${ACCOUNT_ID}/timeentries`)
        .query({ startDate: '2024-01-15', endDate: '2024-01-15' })
        .reply(200, []);

      nock(TMETRIC_BASE_URL)
        .get(`/api/v3/accounts/${ACCOUNT_ID}/timeentries/tags`)
        .reply(200, [
          { id: 2, name: 'Research', isWorkType: true },
          { id: 3, name: 'Meeting', isWorkType: true },
        ]);

      const result = await client.startTimer(123, 'Task', undefined, [
        'Research',
        'Meeting',
      ]);

      expect(result.success).toBe(false);
      expect(result.error).toBe('INVALID_TAGS');
    });

    it('should find the new timer when the API returns an array of entries', async () => {
      nock(TMETRIC_BASE_URL)
        .get(`/api/v3/accounts/${ACCOUNT_ID}/timeentries`)
        .query({ startDate: '2024-01-15', endDate: '2024-01-15' })
        .reply(200, []);

      const earlierEntry: TMetricTimeEntry = {
        id: 'earlier-entry',
        startTime: '2024-01-15T09:00:00',
        endTime: '2024-01-15T10:00:00',
        project: { id: 123, name: 'Test Project' },
        task: { name: 'Earlier Task' },
      };
      const newEntry: TMetricTimeEntry = {
        id: 'new-entry',
        startTime: '2024-01-15T12:00:00',
        endTime: null,
        project: { id: 123, name: 'Test Project' },
        task: { name: 'New Task' },
      };

      // Per the API spec, POST returns all entries for the affected days.
      // The new (running) entry is deliberately NOT last, so this fails if
      // the matching logic is replaced with a positional guess.
      nock(TMETRIC_BASE_URL)
        .post(`/api/v3/accounts/${ACCOUNT_ID}/timeentries`)
        .reply(200, [newEntry, earlierEntry]);

      const result = await client.startTimer(123, 'New Task');

      expect(result.success).toBe(true);
      expect(result.timer_id).toBe('new-entry');
      expect(result.started_at).toBe('2024-01-15T12:00:00');
    });

    it('should report when the started timer cannot be identified in the response', async () => {
      nock(TMETRIC_BASE_URL)
        .get(`/api/v3/accounts/${ACCOUNT_ID}/timeentries`)
        .query({ startDate: '2024-01-15', endDate: '2024-01-15' })
        .reply(200, []);

      // Array response with no running entry in it
      nock(TMETRIC_BASE_URL)
        .post(`/api/v3/accounts/${ACCOUNT_ID}/timeentries`)
        .reply(200, [
          {
            id: 'stopped-entry',
            startTime: '2024-01-15T09:00:00',
            endTime: '2024-01-15T10:00:00',
            project: { id: 123, name: 'Test Project' },
            task: { name: 'Other Task' },
          },
        ]);

      const result = await client.startTimer(123, 'New Task');

      expect(result.success).toBe(false);
      expect(result.error).toBe('ENTRY_CREATED_BUT_NOT_IDENTIFIED');
    });

    it('should fail when timer already running', async () => {
      const runningEntry: TMetricTimeEntry[] = [
        {
          id: 'existing-entry',
          startTime: '2024-01-15T10:00:00Z',
          endTime: null,
          project: { id: 456, name: 'Other Project' },
          task: { name: 'Existing Task' },
        },
      ];

      nock(TMETRIC_BASE_URL)
        .get(`/api/v3/accounts/${ACCOUNT_ID}/timeentries`)
        .query({ startDate: '2024-01-15', endDate: '2024-01-15' })
        .reply(200, runningEntry);

      const result = await client.startTimer(123, 'New Task');

      expect(result.success).toBe(false);
      expect(result.error).toBe('TIMER_ALREADY_RUNNING');
      expect(result.message).toContain('Cannot start new timer');
      expect(result.current_timer).toBeDefined();
      expect(result.current_timer?.task_name).toBe('Existing Task');
    });

    it('should handle GitLab URL without issue number', async () => {
      nock(TMETRIC_BASE_URL)
        .get(`/api/v3/accounts/${ACCOUNT_ID}/timeentries`)
        .query({ startDate: '2024-01-15', endDate: '2024-01-15' })
        .reply(200, []);

      const mockResponse: TMetricTimeEntry = {
        id: 'new-entry',
        startTime: '2024-01-15T12:00:00Z',
        endTime: null,
        project: { id: 123, name: 'Test Project' },
        task: { name: 'Task without issue' },
      };

      nock(TMETRIC_BASE_URL)
        .post(`/api/v3/accounts/${ACCOUNT_ID}/timeentries`, (body) => {
          // Should not have externalLink or integration
          expect(body.task.externalLink).toBeUndefined();
          expect(body.task.integration).toBeUndefined();
          return true;
        })
        .reply(200, mockResponse);

      const result = await client.startTimer(
        123,
        'Task without issue',
        'https://gitlab.com/test/repo' // No /issues/N
      );

      expect(result.success).toBe(true);
    });

    it('should handle API errors', async () => {
      nock(TMETRIC_BASE_URL)
        .get(`/api/v3/accounts/${ACCOUNT_ID}/timeentries`)
        .query({ startDate: '2024-01-15', endDate: '2024-01-15' })
        .reply(200, []);

      nock(TMETRIC_BASE_URL)
        .post(`/api/v3/accounts/${ACCOUNT_ID}/timeentries`)
        .reply(400, { error: 'Bad request' });

      const result = await client.startTimer(123, 'Task');

      expect(result.success).toBe(false);
      expect(result.error).toBe('API_ERROR');
      expect(result.message).toContain('Failed to start timer');
    });
  });

  describe('createTimeEntry', () => {
    beforeEach(async () => {
      nock(TMETRIC_BASE_URL)
        .get('/api/v3/user')
        .reply(200, { activeAccountId: ACCOUNT_ID });

      await client.initialize();
    });

    it('should create a completed entry for a past time range', async () => {
      const mockResponse: TMetricTimeEntry = {
        id: 'past-entry',
        startTime: '2024-01-15T09:00:00',
        endTime: '2024-01-15T10:30:00',
        project: { id: 123, name: 'Test Project' },
        task: { name: 'Past Task' },
      };

      nock(TMETRIC_BASE_URL)
        .post(`/api/v3/accounts/${ACCOUNT_ID}/timeentries`, (body) => {
          expect(body.startTime).toBe('2024-01-15T09:00:00');
          expect(body.endTime).toBe('2024-01-15T10:30:00');
          expect(body.project.id).toBe(123);
          expect(body.task.name).toBe('Past Task');
          expect(body.task.externalLink).toBeUndefined();
          return true;
        })
        .reply(200, mockResponse);

      const result = await client.createTimeEntry(
        123,
        'Past Task',
        '2024-01-15T09:00:00',
        '2024-01-15T10:30:00'
      );

      expect(result.success).toBe(true);
      expect(result.entry_id).toBe('past-entry');
      expect(result.task_name).toBe('Past Task');
      expect(result.time_spent).toBe('1h30m');
      expect(result.time_spent_minutes).toBe(90);
    });

    it('should attach issue link when task_url provided', async () => {
      const mockResponse: TMetricTimeEntry = {
        id: 'past-entry',
        startTime: '2024-01-15T09:00:00',
        endTime: '2024-01-15T10:00:00',
        project: { id: 123, name: 'Test Project' },
        task: { name: 'ABC-9 Past work' },
      };

      nock(TMETRIC_BASE_URL)
        .post(`/api/v3/accounts/${ACCOUNT_ID}/timeentries`, (body) => {
          expect(body.task.externalLink.link).toBe(
            'https://example.youtrack.cloud/issue/ABC-9'
          );
          expect(body.task.externalLink.issueId).toBe('ABC-9');
          expect(body.task.integration.type).toBe('YouTrack');
          return true;
        })
        .reply(200, mockResponse);

      const result = await client.createTimeEntry(
        123,
        'ABC-9 Past work',
        '2024-01-15T09:00:00',
        '2024-01-15T10:00:00',
        'https://example.youtrack.cloud/issue/ABC-9'
      );

      expect(result.success).toBe(true);
    });

    it('should attach resolved tags', async () => {
      nock(TMETRIC_BASE_URL)
        .get(`/api/v3/accounts/${ACCOUNT_ID}/timeentries/tags`)
        .reply(200, [{ id: 5, name: 'Billing', isWorkType: false }]);

      nock(TMETRIC_BASE_URL)
        .post(`/api/v3/accounts/${ACCOUNT_ID}/timeentries`, (body) => {
          expect(body.tags).toEqual([{ id: 5, name: 'Billing', isWorkType: false }]);
          return true;
        })
        .reply(200, {
          id: 'past-entry',
          startTime: '2024-01-15T09:00:00',
          endTime: '2024-01-15T10:00:00',
          project: { id: 123, name: 'Test Project' },
          task: { name: 'Task' },
        });

      const result = await client.createTimeEntry(
        123,
        'Task',
        '2024-01-15T09:00:00',
        '2024-01-15T10:00:00',
        undefined,
        ['Billing']
      );

      expect(result.success).toBe(true);
    });

    it('should find the created entry when the API returns an array of entries', async () => {
      const otherEntry: TMetricTimeEntry = {
        id: 'other-entry',
        startTime: '2024-01-15T14:00:00',
        endTime: '2024-01-15T15:00:00',
        project: { id: 123, name: 'Test Project' },
        task: { name: 'Other Task' },
      };
      const createdEntry: TMetricTimeEntry = {
        id: 'past-entry',
        startTime: '2024-01-15T09:00:00',
        endTime: '2024-01-15T10:30:00',
        project: { id: 123, name: 'Test Project' },
        task: { name: 'Past Task' },
      };

      // Per the API spec, POST returns all entries for the affected days
      nock(TMETRIC_BASE_URL)
        .post(`/api/v3/accounts/${ACCOUNT_ID}/timeentries`)
        .reply(200, [createdEntry, otherEntry]);

      const result = await client.createTimeEntry(
        123,
        'Past Task',
        '2024-01-15T09:00:00',
        '2024-01-15T10:30:00'
      );

      expect(result.success).toBe(true);
      expect(result.entry_id).toBe('past-entry');
    });

    it('should reject when end time is not after start time', async () => {
      const result = await client.createTimeEntry(
        123,
        'Task',
        '2024-01-15T10:00:00',
        '2024-01-15T09:00:00'
      );

      expect(result.success).toBe(false);
      expect(result.error).toBe('INVALID_TIME_RANGE');
    });

    it('should reject unparseable times', async () => {
      const result = await client.createTimeEntry(
        123,
        'Task',
        'not-a-time',
        '2024-01-15T10:00:00'
      );

      expect(result.success).toBe(false);
      expect(result.error).toBe('INVALID_TIME_FORMAT');
    });

    it('should reject times with a Z suffix or timezone offset', async () => {
      const withZ = await client.createTimeEntry(
        123,
        'Task',
        '2024-01-15T09:00:00Z',
        '2024-01-15T10:30:00'
      );
      expect(withZ.success).toBe(false);
      expect(withZ.error).toBe('INVALID_TIME_FORMAT');

      const withOffset = await client.createTimeEntry(
        123,
        'Task',
        '2024-01-15T09:00:00',
        '2024-01-15T10:30:00+02:00'
      );
      expect(withOffset.success).toBe(false);
      expect(withOffset.error).toBe('INVALID_TIME_FORMAT');
    });

    it('should report when the created entry cannot be identified in the response', async () => {
      nock(TMETRIC_BASE_URL)
        .post(`/api/v3/accounts/${ACCOUNT_ID}/timeentries`)
        .reply(200, []);

      const result = await client.createTimeEntry(
        123,
        'Task',
        '2024-01-15T09:00:00',
        '2024-01-15T10:00:00'
      );

      expect(result.success).toBe(false);
      expect(result.error).toBe('ENTRY_CREATED_BUT_NOT_IDENTIFIED');
    });

    it('should fail with UNKNOWN_TAG for a tag not in the account', async () => {
      nock(TMETRIC_BASE_URL)
        .get(`/api/v3/accounts/${ACCOUNT_ID}/timeentries/tags`)
        .reply(200, [{ id: 1, name: 'Development', isWorkType: false }]);

      const result = await client.createTimeEntry(
        123,
        'Task',
        '2024-01-15T09:00:00',
        '2024-01-15T10:00:00',
        undefined,
        ['Nonexistent']
      );

      expect(result.success).toBe(false);
      expect(result.error).toBe('UNKNOWN_TAG');
    });

    it('should handle API errors', async () => {
      nock(TMETRIC_BASE_URL)
        .post(`/api/v3/accounts/${ACCOUNT_ID}/timeentries`)
        .reply(400, { error: 'Bad request' });

      const result = await client.createTimeEntry(
        123,
        'Task',
        '2024-01-15T09:00:00',
        '2024-01-15T10:00:00'
      );

      expect(result.success).toBe(false);
      expect(result.error).toBe('API_ERROR');
      expect(result.message).toContain('Failed to create time entry');
    });
  });

  describe('stopTimer', () => {
    beforeEach(async () => {
      nock(TMETRIC_BASE_URL)
        .get('/api/v3/user')
        .reply(200, { activeAccountId: ACCOUNT_ID });

      await client.initialize();
    });

    it('should stop running timer and return time spent', async () => {
      const runningEntry: TMetricTimeEntry = {
        id: 'timer-123',
        startTime: '2024-01-15T10:00:00Z',
        endTime: null,
        project: { id: 456, name: 'Test Project' },
        task: { name: 'Test Task' },
      };

      // Mock getActiveTimeEntry (used by stopTimer)
      nock(TMETRIC_BASE_URL)
        .get(`/api/v3/accounts/${ACCOUNT_ID}/timeentries`)
        .query({ startDate: '2024-01-15', endDate: '2024-01-15' })
        .reply(200, [runningEntry]);

      // Mock update entry (endTime format without Z suffix for local time)
      nock(TMETRIC_BASE_URL)
        .put(`/api/v3/accounts/${ACCOUNT_ID}/timeentries/timer-123`, (body) => {
          // Check that endTime is in local format (no Z suffix)
          expect(body.endTime).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}$/);
          expect(body.project.id).toBe(456);
          expect(body.task.name).toBe('Test Task');
          return true;
        })
        .reply(200, [{ ...runningEntry, endTime: '2024-01-15T12:00:00' }]);

      const result = await client.stopTimer();

      expect(result.success).toBe(true);
      expect(result.time_spent).toBe('2h'); // 10:00 to 12:00
      expect(result.time_spent_minutes).toBe(120);
      expect(result.started_at).toBe('2024-01-15T10:00:00Z');
      expect(result.task_name).toBe('Test Task');
    });

    it('should fail when no timer is running', async () => {
      nock(TMETRIC_BASE_URL)
        .get(`/api/v3/accounts/${ACCOUNT_ID}/timeentries`)
        .query({ startDate: '2024-01-15', endDate: '2024-01-15' })
        .reply(200, []);

      const result = await client.stopTimer();

      expect(result.success).toBe(false);
      expect(result.error).toBe('NO_TIMER_RUNNING');
      expect(result.message).toBe('No active timer to stop');
    });

    it('should handle partial hours correctly', async () => {
      const runningEntry: TMetricTimeEntry = {
        id: 'timer-123',
        startTime: '2024-01-15T10:30:00Z', // Started at 10:30
        endTime: null,
        project: { id: 456, name: 'Test Project' },
        task: { name: 'Test Task' },
      };

      nock(TMETRIC_BASE_URL)
        .get(`/api/v3/accounts/${ACCOUNT_ID}/timeentries`)
        .query({ startDate: '2024-01-15', endDate: '2024-01-15' })
        .reply(200, [runningEntry]);

      nock(TMETRIC_BASE_URL)
        .get(`/api/v3/accounts/${ACCOUNT_ID}/timeentries/timer-123`)
        .reply(200, runningEntry);

      nock(TMETRIC_BASE_URL)
        .put(`/api/v3/accounts/${ACCOUNT_ID}/timeentries/timer-123`)
        .reply(200, { ...runningEntry, endTime: '2024-01-15T12:00:00Z' });

      const result = await client.stopTimer();

      expect(result.success).toBe(true);
      expect(result.time_spent).toBe('1h30m'); // 10:30 to 12:00
      expect(result.time_spent_minutes).toBe(90);
    });

    it('should handle API errors when getting entry', async () => {
      const runningEntry: TMetricTimeEntry = {
        id: 'timer-123',
        startTime: '2024-01-15T10:00:00Z',
        endTime: null,
        project: { id: 456, name: 'Test Project' },
        task: { name: 'Test Task' },
      };

      nock(TMETRIC_BASE_URL)
        .get(`/api/v3/accounts/${ACCOUNT_ID}/timeentries`)
        .query({ startDate: '2024-01-15', endDate: '2024-01-15' })
        .reply(200, [runningEntry]);

      nock(TMETRIC_BASE_URL)
        .get(`/api/v3/accounts/${ACCOUNT_ID}/timeentries/timer-123`)
        .reply(500, { error: 'Server error' });

      const result = await client.stopTimer();

      expect(result.success).toBe(false);
      expect(result.error).toBe('API_ERROR');
    });

    it('should handle API errors when updating entry', async () => {
      const runningEntry: TMetricTimeEntry = {
        id: 'timer-123',
        startTime: '2024-01-15T10:00:00Z',
        endTime: null,
        project: { id: 456, name: 'Test Project' },
        task: { name: 'Test Task' },
      };

      nock(TMETRIC_BASE_URL)
        .get(`/api/v3/accounts/${ACCOUNT_ID}/timeentries`)
        .query({ startDate: '2024-01-15', endDate: '2024-01-15' })
        .reply(200, [runningEntry]);

      nock(TMETRIC_BASE_URL)
        .get(`/api/v3/accounts/${ACCOUNT_ID}/timeentries/timer-123`)
        .reply(200, runningEntry);

      nock(TMETRIC_BASE_URL)
        .put(`/api/v3/accounts/${ACCOUNT_ID}/timeentries/timer-123`)
        .reply(400, { error: 'Bad request' });

      const result = await client.stopTimer();

      expect(result.success).toBe(false);
      expect(result.error).toBe('API_ERROR');
    });
  });

  describe('listTimeEntries', () => {
    beforeEach(async () => {
      nock(TMETRIC_BASE_URL)
        .get('/api/v3/user')
        .reply(200, { activeAccountId: ACCOUNT_ID });

      await client.initialize();
    });

    it('should list entries for a date range', async () => {
      const mockEntries: TMetricTimeEntry[] = [
        {
          id: 'entry-2',
          startTime: '2024-01-12T14:00:00',
          endTime: '2024-01-12T15:30:00',
          project: { id: 456, name: 'Other Project' },
          note: 'Note-only entry',
          tags: [{ id: 30001, name: 'Development', isWorkType: false }],
        },
        {
          id: 'entry-1',
          startTime: '2024-01-10T09:00:00',
          endTime: '2024-01-10T10:00:00',
          project: { id: 123, name: 'Test Project' },
          task: {
            name: 'ABC-5 Some work',
            externalLink: {
              link: 'https://example.youtrack.cloud/issue/ABC-5',
              issueId: 'ABC-5',
            },
          },
        },
      ];

      nock(TMETRIC_BASE_URL)
        .get(`/api/v3/accounts/${ACCOUNT_ID}/timeentries`)
        .query({ startDate: '2024-01-10', endDate: '2024-01-15' })
        .reply(200, mockEntries);

      const result = await client.listTimeEntries('2024-01-10', '2024-01-15');

      expect(result.success).toBe(true);
      expect(result.entries).toEqual([
        {
          id: 'entry-1',
          task_name: 'ABC-5 Some work',
          project_name: 'Test Project',
          project_id: 123,
          start_time: '2024-01-10T09:00:00',
          end_time: '2024-01-10T10:00:00',
          is_running: false,
          duration_minutes: 60,
          task_url: 'https://example.youtrack.cloud/issue/ABC-5',
          tags: [],
        },
        {
          id: 'entry-2',
          task_name: 'Note-only entry',
          project_name: 'Other Project',
          project_id: 456,
          start_time: '2024-01-12T14:00:00',
          end_time: '2024-01-12T15:30:00',
          is_running: false,
          duration_minutes: 90,
          task_url: undefined,
          tags: ['Development'],
        },
      ]);
    });

    it('should mark a running entry and leave its duration unset', async () => {
      const mockEntries: TMetricTimeEntry[] = [
        {
          id: 'running-entry',
          startTime: '2024-01-15T11:00:00Z',
          endTime: null,
          project: { id: 123, name: 'Test Project' },
          task: { name: 'Ongoing work' },
        },
      ];

      nock(TMETRIC_BASE_URL)
        .get(`/api/v3/accounts/${ACCOUNT_ID}/timeentries`)
        .query({ startDate: '2024-01-15', endDate: '2024-01-15' })
        .reply(200, mockEntries);

      const result = await client.listTimeEntries('2024-01-15', '2024-01-15');

      expect(result.success).toBe(true);
      expect(result.entries[0].is_running).toBe(true);
      expect(result.entries[0].end_time).toBeNull();
      expect(result.entries[0].duration_minutes).toBeNull();
    });

    it('should return empty list when no entries in range', async () => {
      nock(TMETRIC_BASE_URL)
        .get(`/api/v3/accounts/${ACCOUNT_ID}/timeentries`)
        .query({ startDate: '2024-01-01', endDate: '2024-01-02' })
        .reply(200, []);

      const result = await client.listTimeEntries('2024-01-01', '2024-01-02');

      expect(result.success).toBe(true);
      expect(result.entries).toEqual([]);
    });

    it('should reject dates that are not YYYY-MM-DD', async () => {
      const result = await client.listTimeEntries('15/01/2024', '2024-01-15');

      expect(result.success).toBe(false);
      expect(result.error).toBe('INVALID_DATE_FORMAT');
    });

    it('should reject when end date is before start date', async () => {
      const result = await client.listTimeEntries('2024-01-15', '2024-01-10');

      expect(result.success).toBe(false);
      expect(result.error).toBe('INVALID_DATE_RANGE');
    });

    it('should handle API errors', async () => {
      nock(TMETRIC_BASE_URL)
        .get(`/api/v3/accounts/${ACCOUNT_ID}/timeentries`)
        .query({ startDate: '2024-01-10', endDate: '2024-01-15' })
        .reply(500, { error: 'Server error' });

      const result = await client.listTimeEntries('2024-01-10', '2024-01-15');

      expect(result.success).toBe(false);
      expect(result.error).toBe('API_ERROR');
      expect(result.message).toContain('Failed to list time entries');
    });
  });

  describe('updateTimeEntry', () => {
    // Search window with system time 2024-01-15: 31 days back, 7 days forward
    const SEARCH_QUERY = { startDate: '2023-12-15', endDate: '2024-01-22' };

    const existingEntry: TMetricTimeEntry = {
      id: 'entry-42',
      startTime: '2024-01-10T09:00:00',
      endTime: '2024-01-10T10:00:00',
      project: { id: 123, name: 'Test Project' },
      task: {
        name: 'Old name',
        externalLink: {
          link: 'https://github.com/user/repo/issues/7',
          issueId: 'GitHub Issue: #7',
        },
      },
    };

    beforeEach(async () => {
      nock(TMETRIC_BASE_URL)
        .get('/api/v3/user')
        .reply(200, { activeAccountId: ACCOUNT_ID });

      await client.initialize();
    });

    it('should update the task name and keep every other field', async () => {
      nock(TMETRIC_BASE_URL)
        .get(`/api/v3/accounts/${ACCOUNT_ID}/timeentries`)
        .query(SEARCH_QUERY)
        .reply(200, [existingEntry]);

      nock(TMETRIC_BASE_URL)
        .put(`/api/v3/accounts/${ACCOUNT_ID}/timeentries/entry-42`, (body) => {
          expect(body.task.name).toBe('New name');
          expect(body.task.externalLink.issueId).toBe('GitHub Issue: #7');
          expect(body.startTime).toBe('2024-01-10T09:00:00');
          expect(body.endTime).toBe('2024-01-10T10:00:00');
          expect(body.project.id).toBe(123);
          return true;
        })
        .reply(200, { ...existingEntry, task: { name: 'New name' } });

      const result = await client.updateTimeEntry('entry-42', {
        taskName: 'New name',
      });

      expect(result.success).toBe(true);
      expect(result.entry_id).toBe('entry-42');
      expect(result.task_name).toBe('New name');
    });

    it('should update start and end times', async () => {
      nock(TMETRIC_BASE_URL)
        .get(`/api/v3/accounts/${ACCOUNT_ID}/timeentries`)
        .query(SEARCH_QUERY)
        .reply(200, [existingEntry]);

      nock(TMETRIC_BASE_URL)
        .put(`/api/v3/accounts/${ACCOUNT_ID}/timeentries/entry-42`, (body) => {
          expect(body.startTime).toBe('2024-01-10T08:00:00');
          expect(body.endTime).toBe('2024-01-10T09:30:00');
          expect(body.task.name).toBe('Old name');
          return true;
        })
        .reply(200, existingEntry);

      const result = await client.updateTimeEntry('entry-42', {
        startTime: '2024-01-10T08:00:00',
        endTime: '2024-01-10T09:30:00',
      });

      expect(result.success).toBe(true);
      expect(result.time_spent_minutes).toBe(90);
    });

    it('should replace the issue link when task_url provided', async () => {
      nock(TMETRIC_BASE_URL)
        .get(`/api/v3/accounts/${ACCOUNT_ID}/timeentries`)
        .query(SEARCH_QUERY)
        .reply(200, [existingEntry]);

      nock(TMETRIC_BASE_URL)
        .put(`/api/v3/accounts/${ACCOUNT_ID}/timeentries/entry-42`, (body) => {
          expect(body.task.externalLink.link).toBe(
            'https://example.youtrack.cloud/issue/ABC-123'
          );
          expect(body.task.externalLink.issueId).toBe('ABC-123');
          expect(body.task.integration.type).toBe('YouTrack');
          return true;
        })
        .reply(200, existingEntry);

      const result = await client.updateTimeEntry('entry-42', {
        taskUrl: 'https://example.youtrack.cloud/issue/ABC-123',
      });

      expect(result.success).toBe(true);
    });

    it('should replace tags when tags provided', async () => {
      nock(TMETRIC_BASE_URL)
        .get(`/api/v3/accounts/${ACCOUNT_ID}/timeentries`)
        .query(SEARCH_QUERY)
        .reply(200, [existingEntry]);

      nock(TMETRIC_BASE_URL)
        .get(`/api/v3/accounts/${ACCOUNT_ID}/timeentries/tags`)
        .reply(200, [{ id: 7, name: 'Deep Work', isWorkType: false }]);

      nock(TMETRIC_BASE_URL)
        .put(`/api/v3/accounts/${ACCOUNT_ID}/timeentries/entry-42`, (body) => {
          expect(body.tags).toEqual([{ id: 7, name: 'Deep Work', isWorkType: false }]);
          return true;
        })
        .reply(200, existingEntry);

      const result = await client.updateTimeEntry('entry-42', {
        tags: ['deep work'],
      });

      expect(result.success).toBe(true);
    });

    it('should fail when the entry is not found in the search window', async () => {
      nock(TMETRIC_BASE_URL)
        .get(`/api/v3/accounts/${ACCOUNT_ID}/timeentries`)
        .query(SEARCH_QUERY)
        .reply(200, [existingEntry]);

      const result = await client.updateTimeEntry('missing-entry', {
        taskName: 'New name',
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe('ENTRY_NOT_FOUND');
    });

    it('should reject when merged end time is not after start time', async () => {
      nock(TMETRIC_BASE_URL)
        .get(`/api/v3/accounts/${ACCOUNT_ID}/timeentries`)
        .query(SEARCH_QUERY)
        .reply(200, [existingEntry]);

      // Existing start is 09:00; new end before that
      const result = await client.updateTimeEntry('entry-42', {
        endTime: '2024-01-10T08:30:00',
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe('INVALID_TIME_RANGE');
    });

    it('should reject unparseable times', async () => {
      const result = await client.updateTimeEntry('entry-42', {
        startTime: 'not-a-time',
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe('INVALID_TIME_FORMAT');
    });

    it('should reject times with a Z suffix or timezone offset', async () => {
      const result = await client.updateTimeEntry('entry-42', {
        startTime: '2024-01-10T08:00:00Z',
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe('INVALID_TIME_FORMAT');
    });

    it('should keep the note when the entry has both a task and a note', async () => {
      const entryWithNote: TMetricTimeEntry = {
        ...existingEntry,
        note: 'Extra context',
      };

      nock(TMETRIC_BASE_URL)
        .get(`/api/v3/accounts/${ACCOUNT_ID}/timeentries`)
        .query(SEARCH_QUERY)
        .reply(200, [entryWithNote]);

      nock(TMETRIC_BASE_URL)
        .put(`/api/v3/accounts/${ACCOUNT_ID}/timeentries/entry-42`, (body) => {
          expect(body.task.name).toBe('New name');
          expect(body.note).toBe('Extra context');
          return true;
        })
        .reply(200, entryWithNote);

      const result = await client.updateTimeEntry('entry-42', {
        taskName: 'New name',
      });

      expect(result.success).toBe(true);
    });

    it('should keep an existing integration when only the name changes', async () => {
      const entryWithIntegration: TMetricTimeEntry = {
        ...existingEntry,
        task: {
          name: 'Old name',
          externalLink: {
            link: 'https://example.youtrack.cloud/issue/ABC-8',
            issueId: 'ABC-8',
          },
          integration: {
            url: 'https://example.youtrack.cloud',
            type: 'YouTrack',
          },
        },
      };

      nock(TMETRIC_BASE_URL)
        .get(`/api/v3/accounts/${ACCOUNT_ID}/timeentries`)
        .query(SEARCH_QUERY)
        .reply(200, [entryWithIntegration]);

      nock(TMETRIC_BASE_URL)
        .put(`/api/v3/accounts/${ACCOUNT_ID}/timeentries/entry-42`, (body) => {
          expect(body.task.externalLink.issueId).toBe('ABC-8');
          expect(body.task.integration.type).toBe('YouTrack');
          return true;
        })
        .reply(200, entryWithIntegration);

      const result = await client.updateTimeEntry('entry-42', {
        taskName: 'New name',
      });

      expect(result.success).toBe(true);
    });

    it('should use the note as task name when adding an issue link to a note-only entry', async () => {
      const noteOnlyEntry: TMetricTimeEntry = {
        id: 'note-entry',
        startTime: '2024-01-10T09:00:00',
        endTime: '2024-01-10T10:00:00',
        project: { id: 123, name: 'Test Project' },
        note: 'Working notes',
      };

      nock(TMETRIC_BASE_URL)
        .get(`/api/v3/accounts/${ACCOUNT_ID}/timeentries`)
        .query(SEARCH_QUERY)
        .reply(200, [noteOnlyEntry]);

      nock(TMETRIC_BASE_URL)
        .put(`/api/v3/accounts/${ACCOUNT_ID}/timeentries/note-entry`, (body) => {
          expect(body.task.name).toBe('Working notes');
          expect(body.task.externalLink.issueId).toBe('ABC-123');
          expect(body.note).toBe('Working notes');
          return true;
        })
        .reply(200, noteOnlyEntry);

      const result = await client.updateTimeEntry('note-entry', {
        taskUrl: 'https://example.youtrack.cloud/issue/ABC-123',
      });

      expect(result.success).toBe(true);
    });

    it('should fail when adding an issue link to an entry with no name at all', async () => {
      const namelessEntry: TMetricTimeEntry = {
        id: 'nameless-entry',
        startTime: '2024-01-10T09:00:00',
        endTime: '2024-01-10T10:00:00',
        project: { id: 123, name: 'Test Project' },
      };

      nock(TMETRIC_BASE_URL)
        .get(`/api/v3/accounts/${ACCOUNT_ID}/timeentries`)
        .query(SEARCH_QUERY)
        .reply(200, [namelessEntry]);

      const result = await client.updateTimeEntry('nameless-entry', {
        taskUrl: 'https://example.youtrack.cloud/issue/ABC-123',
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe('TASK_NAME_REQUIRED');
    });

    it('should search only the given entry_date when provided', async () => {
      const oldEntry: TMetricTimeEntry = {
        id: 'old-entry',
        startTime: '2023-11-20T09:00:00',
        endTime: '2023-11-20T10:00:00',
        project: { id: 123, name: 'Test Project' },
        task: { name: 'Old work' },
      };

      nock(TMETRIC_BASE_URL)
        .get(`/api/v3/accounts/${ACCOUNT_ID}/timeentries`)
        .query({ startDate: '2023-11-20', endDate: '2023-11-20' })
        .reply(200, [oldEntry]);

      nock(TMETRIC_BASE_URL)
        .put(`/api/v3/accounts/${ACCOUNT_ID}/timeentries/old-entry`)
        .reply(200, oldEntry);

      const result = await client.updateTimeEntry('old-entry', {
        taskName: 'Renamed old work',
        entryDate: '2023-11-20',
      });

      expect(result.success).toBe(true);
    });

    it('should reject an entry_date that is not YYYY-MM-DD', async () => {
      const result = await client.updateTimeEntry('entry-42', {
        taskName: 'New name',
        entryDate: '20/11/2023',
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe('INVALID_DATE_FORMAT');
    });

    it('should fail with UNKNOWN_TAG for a tag not in the account', async () => {
      nock(TMETRIC_BASE_URL)
        .get(`/api/v3/accounts/${ACCOUNT_ID}/timeentries`)
        .query(SEARCH_QUERY)
        .reply(200, [existingEntry]);

      nock(TMETRIC_BASE_URL)
        .get(`/api/v3/accounts/${ACCOUNT_ID}/timeentries/tags`)
        .reply(200, [{ id: 1, name: 'Development', isWorkType: false }]);

      const result = await client.updateTimeEntry('entry-42', {
        tags: ['Nonexistent'],
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe('UNKNOWN_TAG');
    });

    it('should reject a task_url without a recognizable issue', async () => {
      const result = await client.updateTimeEntry('entry-42', {
        taskUrl: 'https://example.com/no-issue-here',
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe('INVALID_TASK_URL');
    });

    it('should reject when no updates are given', async () => {
      const result = await client.updateTimeEntry('entry-42', {});

      expect(result.success).toBe(false);
      expect(result.error).toBe('NO_UPDATES');
    });

    it('should handle API errors on update', async () => {
      nock(TMETRIC_BASE_URL)
        .get(`/api/v3/accounts/${ACCOUNT_ID}/timeentries`)
        .query(SEARCH_QUERY)
        .reply(200, [existingEntry]);

      nock(TMETRIC_BASE_URL)
        .put(`/api/v3/accounts/${ACCOUNT_ID}/timeentries/entry-42`)
        .reply(400, { error: 'Bad request' });

      const result = await client.updateTimeEntry('entry-42', {
        taskName: 'New name',
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe('API_ERROR');
      expect(result.message).toContain('Failed to update time entry');
    });
  });

  describe('deleteTimeEntry', () => {
    beforeEach(async () => {
      nock(TMETRIC_BASE_URL)
        .get('/api/v3/user')
        .reply(200, { activeAccountId: ACCOUNT_ID });

      await client.initialize();
    });

    describe('current mode (default)', () => {
      it('should delete current timer when no mode specified', async () => {
        const runningEntry: TMetricTimeEntry = {
          id: 'timer-456',
          startTime: '2024-01-15T10:00:00Z',
          endTime: null,
          project: { id: 123, name: 'Test' },
          task: { name: 'Task' },
        };

        nock(TMETRIC_BASE_URL)
          .get(`/api/v3/accounts/${ACCOUNT_ID}/timeentries`)
          .query({ startDate: '2024-01-15', endDate: '2024-01-15' })
          .reply(200, [runningEntry]);

        nock(TMETRIC_BASE_URL)
          .delete(`/api/v3/accounts/${ACCOUNT_ID}/timeentries/timer-456`)
          .reply(200);

        const result = await client.deleteTimeEntry();

        expect(result.success).toBe(true);
        expect(result.deleted).toBe('timer-456');
        expect(result.entry_type).toBe('active');
      });

      it('should delete current timer with mode "current"', async () => {
        const runningEntry: TMetricTimeEntry = {
          id: 'timer-456',
          startTime: '2024-01-15T10:00:00Z',
          endTime: null,
          project: { id: 123, name: 'Test' },
          task: { name: 'Task' },
        };

        nock(TMETRIC_BASE_URL)
          .get(`/api/v3/accounts/${ACCOUNT_ID}/timeentries`)
          .query({ startDate: '2024-01-15', endDate: '2024-01-15' })
          .reply(200, [runningEntry]);

        nock(TMETRIC_BASE_URL)
          .delete(`/api/v3/accounts/${ACCOUNT_ID}/timeentries/timer-456`)
          .reply(200);

        const result = await client.deleteTimeEntry('current');

        expect(result.success).toBe(true);
        expect(result.deleted).toBe('timer-456');
        expect(result.entry_type).toBe('active');
      });

      it('should fail when no timer running', async () => {
        nock(TMETRIC_BASE_URL)
          .get(`/api/v3/accounts/${ACCOUNT_ID}/timeentries`)
          .query({ startDate: '2024-01-15', endDate: '2024-01-15' })
          .reply(200, []);

        const result = await client.deleteTimeEntry('current');

        expect(result.success).toBe(false);
        expect(result.error).toBe('NO_TIMER_RUNNING');
        expect(result.message).toBe('No active timer to delete');
      });
    });

    describe('last mode', () => {
      it('should delete active timer with mode "last"', async () => {
        const runningEntry: TMetricTimeEntry = {
          id: 'timer-789',
          startTime: '2024-01-15T11:00:00Z',
          endTime: null,
          project: { id: 123, name: 'Test' },
          task: { name: 'Task' },
        };

        nock(TMETRIC_BASE_URL)
          .get(`/api/v3/accounts/${ACCOUNT_ID}/timeentries`)
          .query({ startDate: '2024-01-15', endDate: '2024-01-15' })
          .reply(200, [runningEntry]);

        nock(TMETRIC_BASE_URL)
          .delete(`/api/v3/accounts/${ACCOUNT_ID}/timeentries/timer-789`)
          .reply(200);

        const result = await client.deleteTimeEntry('last');

        expect(result.success).toBe(true);
        expect(result.deleted).toBe('timer-789');
        expect(result.entry_type).toBe('active');
        expect(result.stopped_ago).toBeUndefined();
      });

      it('should delete recently stopped entry (within 5 minutes)', async () => {
        const stoppedEntry: TMetricTimeEntry = {
          id: 'timer-recent',
          startTime: '2024-01-15T11:00:00Z',
          endTime: '2024-01-15T11:57:00Z', // 3 minutes ago (current time is 12:00)
          project: { id: 123, name: 'Test' },
          task: { name: 'Recent Task' },
        };

        nock(TMETRIC_BASE_URL)
          .get(`/api/v3/accounts/${ACCOUNT_ID}/timeentries`)
          .query({ startDate: '2024-01-15', endDate: '2024-01-15' })
          .reply(200, [stoppedEntry]);

        nock(TMETRIC_BASE_URL)
          .delete(`/api/v3/accounts/${ACCOUNT_ID}/timeentries/timer-recent`)
          .reply(200);

        const result = await client.deleteTimeEntry('last');

        expect(result.success).toBe(true);
        expect(result.deleted).toBe('timer-recent');
        expect(result.entry_type).toBe('stopped');
        expect(result.stopped_ago).toBe('3m');
      });

      it('should fail when entry stopped more than 5 minutes ago', async () => {
        const oldEntry: TMetricTimeEntry = {
          id: 'timer-old',
          startTime: '2024-01-15T10:00:00Z',
          endTime: '2024-01-15T11:00:00Z', // 60 minutes ago
          project: { id: 123, name: 'Test' },
          task: { name: 'Old Task' },
        };

        nock(TMETRIC_BASE_URL)
          .get(`/api/v3/accounts/${ACCOUNT_ID}/timeentries`)
          .query({ startDate: '2024-01-15', endDate: '2024-01-15' })
          .reply(200, [oldEntry]);

        const result = await client.deleteTimeEntry('last');

        expect(result.success).toBe(false);
        expect(result.error).toBe('ENTRY_TOO_OLD');
        expect(result.message).toContain('60 minutes ago');
        expect(result.message).toContain('Use TMetric web UI');
      });

      it('should delete entry stopped exactly at 5 minute boundary', async () => {
        const boundaryEntry: TMetricTimeEntry = {
          id: 'timer-boundary',
          startTime: '2024-01-15T11:00:00Z',
          endTime: '2024-01-15T11:55:00Z', // Exactly 5 minutes ago
          project: { id: 123, name: 'Test' },
          task: { name: 'Boundary Task' },
        };

        nock(TMETRIC_BASE_URL)
          .get(`/api/v3/accounts/${ACCOUNT_ID}/timeentries`)
          .query({ startDate: '2024-01-15', endDate: '2024-01-15' })
          .reply(200, [boundaryEntry]);

        nock(TMETRIC_BASE_URL)
          .delete(`/api/v3/accounts/${ACCOUNT_ID}/timeentries/timer-boundary`)
          .reply(200);

        const result = await client.deleteTimeEntry('last');

        expect(result.success).toBe(true);
        expect(result.deleted).toBe('timer-boundary');
        expect(result.stopped_ago).toBe('5m');
      });

      it('should select most recent entry when multiple exist', async () => {
        const entries: TMetricTimeEntry[] = [
          {
            id: 'timer-older',
            startTime: '2024-01-15T09:00:00Z',
            endTime: '2024-01-15T10:00:00Z',
            project: { id: 123, name: 'Test' },
            task: { name: 'Older Task' },
          },
          {
            id: 'timer-recent',
            startTime: '2024-01-15T11:00:00Z',
            endTime: '2024-01-15T11:58:00Z', // Most recent, 2 min ago
            project: { id: 123, name: 'Test' },
            task: { name: 'Recent Task' },
          },
          {
            id: 'timer-middle',
            startTime: '2024-01-15T10:00:00Z',
            endTime: '2024-01-15T11:00:00Z',
            project: { id: 123, name: 'Test' },
            task: { name: 'Middle Task' },
          },
        ];

        nock(TMETRIC_BASE_URL)
          .get(`/api/v3/accounts/${ACCOUNT_ID}/timeentries`)
          .query({ startDate: '2024-01-15', endDate: '2024-01-15' })
          .reply(200, entries);

        nock(TMETRIC_BASE_URL)
          .delete(`/api/v3/accounts/${ACCOUNT_ID}/timeentries/timer-recent`)
          .reply(200);

        const result = await client.deleteTimeEntry('last');

        expect(result.success).toBe(true);
        expect(result.deleted).toBe('timer-recent');
      });

      it('should fail when no entries exist today', async () => {
        nock(TMETRIC_BASE_URL)
          .get(`/api/v3/accounts/${ACCOUNT_ID}/timeentries`)
          .query({ startDate: '2024-01-15', endDate: '2024-01-15' })
          .reply(200, []);

        const result = await client.deleteTimeEntry('last');

        expect(result.success).toBe(false);
        expect(result.error).toBe('NO_ENTRIES_FOUND');
        expect(result.message).toBe('No time entries found for today');
      });
    });

    it('should handle API errors', async () => {
      const runningEntry: TMetricTimeEntry = {
        id: 'timer-456',
        startTime: '2024-01-15T10:00:00Z',
        endTime: null,
        project: { id: 123, name: 'Test' },
        task: { name: 'Task' },
      };

      nock(TMETRIC_BASE_URL)
        .get(`/api/v3/accounts/${ACCOUNT_ID}/timeentries`)
        .query({ startDate: '2024-01-15', endDate: '2024-01-15' })
        .reply(200, [runningEntry]);

      nock(TMETRIC_BASE_URL)
        .delete(`/api/v3/accounts/${ACCOUNT_ID}/timeentries/timer-456`)
        .reply(404, { error: 'Not found' });

      const result = await client.deleteTimeEntry();

      expect(result.success).toBe(false);
      expect(result.error).toBe('API_ERROR');
      expect(result.message).toContain('Failed to delete entry');
    });

    it('should handle network errors', async () => {
      const runningEntry: TMetricTimeEntry = {
        id: 'timer-456',
        startTime: '2024-01-15T10:00:00Z',
        endTime: null,
        project: { id: 123, name: 'Test' },
        task: { name: 'Task' },
      };

      nock(TMETRIC_BASE_URL)
        .get(`/api/v3/accounts/${ACCOUNT_ID}/timeentries`)
        .query({ startDate: '2024-01-15', endDate: '2024-01-15' })
        .reply(200, [runningEntry]);

      nock(TMETRIC_BASE_URL)
        .delete(`/api/v3/accounts/${ACCOUNT_ID}/timeentries/timer-456`)
        .replyWithError('Network error');

      const result = await client.deleteTimeEntry();

      expect(result.success).toBe(false);
      expect(result.error).toBe('API_ERROR');
    });
  });
});
