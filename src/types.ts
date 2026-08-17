export interface TMetricProject {
  id: number;
  name: string;
}

// Tag shape used by the API (TagBasic): tags are objects, never plain strings
export interface TMetricTag {
  id?: number;
  name?: string;
  isWorkType?: boolean;
}

export interface TMetricTimeEntry {
  id: string;
  startTime: string;
  endTime: string | null;
  project?: {
    id: number;
    name: string;
  };
  task?: {
    name: string;
    externalLink?: {
      link: string;
      issueId: string;
    };
    integration?: {
      url: string;
      type: string;
    };
  };
  note?: string;
  tags?: TMetricTag[];
}

export interface TMetricUser {
  activeAccountId: string;
  email: string;
  name: string;
}

export interface TimerInfo {
  is_running: boolean;
  timer_id?: string;
  task_name?: string;
  task_url?: string;
  project_name?: string;
  project_id?: number;
  started_at?: string;
  elapsed?: string;
}

export interface ApiResponse {
  success: boolean;
  error?: string;
  message?: string;
  [key: string]: any;
}
