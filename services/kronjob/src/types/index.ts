export interface CronJob {
  id: string;
  name: string;
  schedule: string;
  path: string;
  headers: Record<string, string> | null;
  enabled: boolean;
  serviceId: string;
  createdAt: string;
  updatedAt: string;
  lastRunAt: string | null;
  nextRunAt: string | null;
  projectId: string; // Added from Redis publishing
}

export interface CronJobDeletedEvent {
  id: string;
  serviceId: string;
  projectId: string;
}

export interface ApiResponse<T> {
  status: 'success' | 'error';
  message?: string;
  data?: T;
}

export interface CronJobExecution {
  cronJobId: string;
  startTime: Date;
  endTime?: Date;
  status: 'running' | 'success' | 'failed';
  statusCode?: number;
  response?: string;
  error?: string;
}
