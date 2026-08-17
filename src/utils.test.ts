import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  calculateElapsed,
  calculateDurationMinutes,
  formatMinutesToGitLab,
  extractBaseUrl,
  extractIssueNumber,
  extractYouTrackIssueId,
  formatIssueId,
  detectIntegrationType,
  parseIssueUrl,
} from './utils.js';

describe('calculateElapsed', () => {
  beforeEach(() => {
    // Mock the current time to 2024-01-15 10:30:00
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2024-01-15T10:30:00Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('should calculate elapsed time in hours and minutes when hours > 0', () => {
    const startTime = '2024-01-15T08:00:00Z'; // 2h 30m ago
    const result = calculateElapsed(startTime);
    expect(result).toBe('2h 30m');
  });

  it('should calculate elapsed time in minutes only when hours = 0', () => {
    const startTime = '2024-01-15T10:15:00Z'; // 15m ago
    const result = calculateElapsed(startTime);
    expect(result).toBe('15m');
  });

  it('should handle zero minutes', () => {
    const startTime = '2024-01-15T09:30:00Z'; // 1h 0m ago
    const result = calculateElapsed(startTime);
    expect(result).toBe('1h 0m');
  });

  it('should handle edge case of just started timer', () => {
    const startTime = '2024-01-15T10:30:00Z'; // Just now
    const result = calculateElapsed(startTime);
    expect(result).toBe('0m');
  });

  it('should handle long running timers', () => {
    const startTime = '2024-01-15T02:30:00Z'; // 8h ago (within same day to avoid day rollover)
    const result = calculateElapsed(startTime);
    expect(result).toBe('8h 0m');
  });
});

describe('calculateDurationMinutes', () => {
  it('should calculate duration between two times in minutes', () => {
    const startTime = '2024-01-15T10:00:00Z';
    const endTime = '2024-01-15T11:30:00Z';
    const result = calculateDurationMinutes(startTime, endTime);
    expect(result).toBe(90);
  });

  it('should handle duration less than an hour', () => {
    const startTime = '2024-01-15T10:00:00Z';
    const endTime = '2024-01-15T10:45:00Z';
    const result = calculateDurationMinutes(startTime, endTime);
    expect(result).toBe(45);
  });

  it('should handle duration with seconds (floor to minutes)', () => {
    const startTime = '2024-01-15T10:00:00Z';
    const endTime = '2024-01-15T10:30:45Z'; // 30m 45s
    const result = calculateDurationMinutes(startTime, endTime);
    expect(result).toBe(30); // Floors to 30
  });

  it('should handle zero duration', () => {
    const startTime = '2024-01-15T10:00:00Z';
    const endTime = '2024-01-15T10:00:00Z';
    const result = calculateDurationMinutes(startTime, endTime);
    expect(result).toBe(0);
  });

  it('should handle long durations', () => {
    const startTime = '2024-01-15T10:00:00Z';
    const endTime = '2024-01-16T10:00:00Z'; // 24 hours
    const result = calculateDurationMinutes(startTime, endTime);
    expect(result).toBe(1440);
  });
});

describe('formatMinutesToGitLab', () => {
  it('should format hours and minutes', () => {
    expect(formatMinutesToGitLab(150)).toBe('2h30m');
  });

  it('should format hours only when minutes is zero', () => {
    expect(formatMinutesToGitLab(120)).toBe('2h');
  });

  it('should format minutes only when less than an hour', () => {
    expect(formatMinutesToGitLab(45)).toBe('45m');
  });

  it('should handle zero minutes', () => {
    expect(formatMinutesToGitLab(0)).toBe('0m');
  });

  it('should handle single hour', () => {
    expect(formatMinutesToGitLab(60)).toBe('1h');
  });

  it('should handle single minute', () => {
    expect(formatMinutesToGitLab(1)).toBe('1m');
  });

  it('should handle large durations', () => {
    expect(formatMinutesToGitLab(1441)).toBe('24h1m'); // 24h 1m
  });
});

describe('detectIntegrationType', () => {
  it('should detect GitHub URLs', () => {
    const url = 'https://github.com/user/repo/issues/123';
    expect(detectIntegrationType(url)).toBe('GitHub');
  });

  it('should detect GitLab.com URLs', () => {
    const url = 'https://gitlab.com/user/repo/-/issues/123';
    expect(detectIntegrationType(url)).toBe('GitLab');
  });

  it('should detect custom GitLab instance URLs', () => {
    const url = 'https://gitlab.openpolis.io/group/project/-/issues/456';
    expect(detectIntegrationType(url)).toBe('GitLab');
  });

  it('should default to GitLab for invalid URLs', () => {
    const url = 'not-a-valid-url';
    expect(detectIntegrationType(url)).toBe('GitLab');
  });

  it('should detect YouTrack cloud URLs by host', () => {
    const url = 'https://example.youtrack.cloud/issue/ABC-123';
    expect(detectIntegrationType(url)).toBe('YouTrack');
  });

  it('should detect self-hosted YouTrack by "youtrack" in host', () => {
    const url = 'https://youtrack.example.com/issue/ABC-7';
    expect(detectIntegrationType(url)).toBe('YouTrack');
  });

  it('should detect YouTrack by /issue/KEY path on custom domains', () => {
    const url = 'https://tracker.example.com/issue/ABC-99';
    expect(detectIntegrationType(url)).toBe('YouTrack');
  });

  it('should not treat GitLab /issues/ URLs as YouTrack', () => {
    const url = 'https://gitlab.example.com/group/project/-/issues/123';
    expect(detectIntegrationType(url)).toBe('GitLab');
  });
});

describe('extractYouTrackIssueId', () => {
  it('should extract issue key from YouTrack cloud URL', () => {
    const url = 'https://example.youtrack.cloud/issue/ABC-123';
    expect(extractYouTrackIssueId(url)).toBe('ABC-123');
  });

  it('should extract issue key with digits in project key', () => {
    const url = 'https://example.youtrack.cloud/issue/PROJ2-45';
    expect(extractYouTrackIssueId(url)).toBe('PROJ2-45');
  });

  it('should extract issue key from URL with query params', () => {
    const url = 'https://example.youtrack.cloud/issue/ABC-123?focus=comments';
    expect(extractYouTrackIssueId(url)).toBe('ABC-123');
  });

  it('should return null when no issue key present', () => {
    const url = 'https://example.youtrack.cloud/dashboard';
    expect(extractYouTrackIssueId(url)).toBeNull();
  });

  it('should return null for GitLab-style issue URLs', () => {
    const url = 'https://gitlab.example.com/group/project/-/issues/123';
    expect(extractYouTrackIssueId(url)).toBeNull();
  });
});

describe('extractBaseUrl', () => {
  it('should extract base URL from GitLab issue URL', () => {
    const url = 'https://gitlab.openpolis.io/group/project/-/issues/123';
    const result = extractBaseUrl(url);
    expect(result).toBe('https://gitlab.openpolis.io');
  });

  it('should extract base URL from gitlab.com', () => {
    const url = 'https://gitlab.com/user/repo/-/issues/456';
    const result = extractBaseUrl(url);
    expect(result).toBe('https://gitlab.com');
  });

  it('should extract base URL from GitHub', () => {
    const url = 'https://github.com/user/repo/issues/123';
    const result = extractBaseUrl(url);
    expect(result).toBe('https://github.com');
  });

  it('should handle HTTP URLs', () => {
    const url = 'http://gitlab.example.com/project/-/issues/789';
    const result = extractBaseUrl(url);
    expect(result).toBe('http://gitlab.example.com');
  });

  it('should handle URLs with ports', () => {
    const url = 'https://gitlab.example.com:8080/project/-/issues/1';
    const result = extractBaseUrl(url);
    expect(result).toBe('https://gitlab.example.com:8080');
  });

  it('should return default fallback for invalid URLs', () => {
    const url = 'not-a-valid-url';
    const result = extractBaseUrl(url);
    expect(result).toBe('https://gitlab.com');
  });

  it('should handle URLs with complex paths', () => {
    const url = 'https://gitlab.example.com/group/subgroup/project/-/issues/99';
    const result = extractBaseUrl(url);
    expect(result).toBe('https://gitlab.example.com');
  });
});

describe('extractIssueNumber', () => {
  it('should extract issue number from standard GitLab URL', () => {
    const url = 'https://gitlab.com/user/repo/-/issues/123';
    const result = extractIssueNumber(url);
    expect(result).toBe('123');
  });

  it('should extract issue number from GitHub URL', () => {
    const url = 'https://github.com/user/repo/issues/456';
    const result = extractIssueNumber(url);
    expect(result).toBe('456');
  });

  it('should extract issue number from URL with complex path', () => {
    const url = 'https://gitlab.openpolis.io/group/project/-/issues/456';
    const result = extractIssueNumber(url);
    expect(result).toBe('456');
  });

  it('should extract issue number from URL with query params', () => {
    const url = 'https://gitlab.com/user/repo/-/issues/789?tab=notes';
    const result = extractIssueNumber(url);
    expect(result).toBe('789');
  });

  it('should extract issue number from URL with anchor', () => {
    const url = 'https://gitlab.com/user/repo/-/issues/999#note_123';
    const result = extractIssueNumber(url);
    expect(result).toBe('999');
  });

  it('should return null for URL without issue number', () => {
    const url = 'https://gitlab.com/user/repo';
    const result = extractIssueNumber(url);
    expect(result).toBeNull();
  });

  it('should return null for invalid issue URL format', () => {
    const url = 'https://gitlab.com/user/repo/-/merge_requests/123';
    const result = extractIssueNumber(url);
    expect(result).toBeNull();
  });

  it('should handle multi-digit issue numbers', () => {
    const url = 'https://gitlab.com/user/repo/-/issues/123456';
    const result = extractIssueNumber(url);
    expect(result).toBe('123456');
  });
});

describe('formatIssueId', () => {
  it('should format issue number with GitLab prefix', () => {
    const result = formatIssueId('123', 'GitLab');
    expect(result).toBe('GitLab Issue: #123');
  });

  it('should format issue number with GitHub prefix', () => {
    const result = formatIssueId('456', 'GitHub');
    expect(result).toBe('GitHub Issue: #456');
  });

  it('should format single digit issue number', () => {
    const result = formatIssueId('1', 'GitLab');
    expect(result).toBe('GitLab Issue: #1');
  });

  it('should format multi-digit issue number', () => {
    const result = formatIssueId('999999', 'GitHub');
    expect(result).toBe('GitHub Issue: #999999');
  });

  it('should handle issue number as string', () => {
    const result = formatIssueId('0', 'GitLab');
    expect(result).toBe('GitLab Issue: #0');
  });

  it('should return the raw issue key for YouTrack', () => {
    const result = formatIssueId('ABC-123', 'YouTrack');
    expect(result).toBe('ABC-123');
  });
});

describe('parseIssueUrl', () => {
  it('should parse a GitLab issue URL', () => {
    const url = 'https://gitlab.example.com/group/project/-/issues/123';
    expect(parseIssueUrl(url)).toEqual({
      integrationType: 'GitLab',
      baseUrl: 'https://gitlab.example.com',
      issueId: 'GitLab Issue: #123',
    });
  });

  it('should parse a GitHub issue URL', () => {
    const url = 'https://github.com/user/repo/issues/456';
    expect(parseIssueUrl(url)).toEqual({
      integrationType: 'GitHub',
      baseUrl: 'https://github.com',
      issueId: 'GitHub Issue: #456',
    });
  });

  it('should parse a YouTrack issue URL', () => {
    const url = 'https://example.youtrack.cloud/issue/ABC-123';
    expect(parseIssueUrl(url)).toEqual({
      integrationType: 'YouTrack',
      baseUrl: 'https://example.youtrack.cloud',
      issueId: 'ABC-123',
    });
  });

  it('should return null for a URL without an issue reference', () => {
    const url = 'https://gitlab.com/user/repo';
    expect(parseIssueUrl(url)).toBeNull();
  });

  it('should return null for a YouTrack host URL without an issue key', () => {
    const url = 'https://example.youtrack.cloud/dashboard';
    expect(parseIssueUrl(url)).toBeNull();
  });
});
