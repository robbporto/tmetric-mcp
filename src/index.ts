#!/usr/bin/env node

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { TMetricClient } from './tmetric-client.js';

// Get API token from environment
const TMETRIC_API_TOKEN = process.env.TMETRIC_API_TOKEN;

if (!TMETRIC_API_TOKEN) {
  console.error('Error: TMETRIC_API_TOKEN environment variable is required');
  process.exit(1);
}

// Initialize TMetric client
const tmetricClient = new TMetricClient(TMETRIC_API_TOKEN);

// Initialize MCP server
const server = new Server(
  {
    name: 'tmetric-minimal-mcp',
    version: '2.0.0',
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// List available tools
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: 'list_tmetric_projects',
        description: 'Get list of available TMetric projects for time tracking',
        inputSchema: {
          type: 'object',
          properties: {},
        },
      },
      {
        name: 'get_current_timer',
        description: 'Check if a timer is currently running and get its details',
        inputSchema: {
          type: 'object',
          properties: {},
        },
      },
      {
        name: 'start_timer',
        description: 'Start time tracking on a project and task. Will fail if another timer is already running.',
        inputSchema: {
          type: 'object',
          properties: {
            project_id: {
              type: 'number',
              description: 'TMetric project ID',
            },
            task_name: {
              type: 'string',
              description: 'Name of the task (e.g., "Issue #123: Fix bug")',
            },
            task_url: {
              type: 'string',
              description: 'Optional GitLab, GitHub or YouTrack issue URL for integration',
            },
            tags: {
              type: 'array',
              items: { type: 'string' },
              description: 'Optional tag names. Tags must already exist in the TMetric account.',
            },
          },
          required: ['project_id', 'task_name'],
        },
      },
      {
        name: 'create_time_entry',
        description: 'Create a completed time entry for a past time range. Does not touch the running timer.',
        inputSchema: {
          type: 'object',
          properties: {
            project_id: {
              type: 'number',
              description: 'TMetric project ID',
            },
            task_name: {
              type: 'string',
              description: 'Name of the task (e.g., "Issue #123: Fix bug")',
            },
            start_time: {
              type: 'string',
              description: 'Start time as local ISO date-time without "Z" (e.g., "2024-01-15T09:00:00")',
            },
            end_time: {
              type: 'string',
              description: 'End time as local ISO date-time without "Z" (e.g., "2024-01-15T10:30:00")',
            },
            task_url: {
              type: 'string',
              description: 'Optional GitLab, GitHub or YouTrack issue URL for integration',
            },
            tags: {
              type: 'array',
              items: { type: 'string' },
              description: 'Optional tag names. Tags must already exist in the TMetric account.',
            },
          },
          required: ['project_id', 'task_name', 'start_time', 'end_time'],
        },
      },
      {
        name: 'update_time_entry',
        description: 'Update an existing time entry. Fields that are not provided keep their current values. Use list_time_entries first to find the entry ID.',
        inputSchema: {
          type: 'object',
          properties: {
            entry_id: {
              type: 'string',
              description: 'ID of the time entry to update (from list_time_entries)',
            },
            task_name: {
              type: 'string',
              description: 'New task name',
            },
            project_id: {
              type: 'number',
              description: 'New TMetric project ID',
            },
            start_time: {
              type: 'string',
              description: 'New start time as local ISO date-time without "Z" (e.g., "2024-01-15T09:00:00")',
            },
            end_time: {
              type: 'string',
              description: 'New end time as local ISO date-time without "Z" (e.g., "2024-01-15T10:30:00")',
            },
            task_url: {
              type: 'string',
              description: 'New GitLab, GitHub or YouTrack issue URL; replaces the entry\'s issue link',
            },
            tags: {
              type: 'array',
              items: { type: 'string' },
              description: 'New tag names; replaces all tags on the entry (empty array clears them). Tags must already exist in the TMetric account.',
            },
          },
          required: ['entry_id'],
        },
      },
      {
        name: 'list_time_entries',
        description: 'List time entries in a date range (inclusive), oldest first. Use this to find an entry ID before updating an entry.',
        inputSchema: {
          type: 'object',
          properties: {
            start_date: {
              type: 'string',
              description: 'First day of the range, YYYY-MM-DD',
            },
            end_date: {
              type: 'string',
              description: 'Last day of the range, YYYY-MM-DD',
            },
          },
          required: ['start_date', 'end_date'],
        },
      },
      {
        name: 'stop_timer',
        description: 'Stop the currently running timer and return time spent',
        inputSchema: {
          type: 'object',
          properties: {},
        },
      },
      {
        name: 'delete_time_entry',
        description: 'Delete a time entry. Mode "current" deletes active timer only, "last" deletes most recent entry (with 5-min safety window).',
        inputSchema: {
          type: 'object',
          properties: {
            mode: {
              type: 'string',
              enum: ['current', 'last'],
              description: 'Deletion mode: "current" for active timer only, "last" for most recent entry',
              default: 'current',
            },
          },
        },
      },
    ],
  };
});

// Handle tool calls
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    switch (name) {
      case 'list_tmetric_projects': {
        const result = await tmetricClient.listProjects();
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      }

      case 'get_current_timer': {
        const result = await tmetricClient.getCurrentTimer();
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      }

      case 'start_timer': {
        const { project_id, task_name, task_url, tags } = args as {
          project_id: number;
          task_name: string;
          task_url?: string;
          tags?: string[];
        };

        const result = await tmetricClient.startTimer(
          project_id,
          task_name,
          task_url,
          tags
        );

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      }

      case 'create_time_entry': {
        const { project_id, task_name, start_time, end_time, task_url, tags } = args as {
          project_id: number;
          task_name: string;
          start_time: string;
          end_time: string;
          task_url?: string;
          tags?: string[];
        };

        const result = await tmetricClient.createTimeEntry(
          project_id,
          task_name,
          start_time,
          end_time,
          task_url,
          tags
        );

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      }

      case 'update_time_entry': {
        const { entry_id, task_name, project_id, start_time, end_time, task_url, tags } =
          args as {
            entry_id: string;
            task_name?: string;
            project_id?: number;
            start_time?: string;
            end_time?: string;
            task_url?: string;
            tags?: string[];
          };

        const result = await tmetricClient.updateTimeEntry(entry_id, {
          taskName: task_name,
          projectId: project_id,
          startTime: start_time,
          endTime: end_time,
          taskUrl: task_url,
          tags,
        });

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      }

      case 'list_time_entries': {
        const { start_date, end_date } = args as {
          start_date: string;
          end_date: string;
        };

        const result = await tmetricClient.listTimeEntries(start_date, end_date);

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      }

      case 'stop_timer': {
        const result = await tmetricClient.stopTimer();
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      }

      case 'delete_time_entry': {
        const { mode } = args as { mode?: 'current' | 'last' };
        const result = await tmetricClient.deleteTimeEntry(mode);
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      }

      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  } catch (error: any) {
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(
            {
              success: false,
              error: 'INTERNAL_ERROR',
              message: error.message,
            },
            null,
            2
          ),
        },
      ],
      isError: true,
    };
  }
});

// Start server
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('TMetric Minimal MCP server running on stdio');
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
