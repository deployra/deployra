import * as dotenv from 'dotenv';

dotenv.config();

export const config = {
  redis: {
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT || '6379'),
    username: process.env.REDIS_USERNAME || '',
    password: process.env.REDIS_PASSWORD || '',
    channels: {
      cronJobAdded: process.env.REDIS_CHANNEL_CRONJOB_ADDED || 'cronjob:added',
      cronJobUpdated: process.env.REDIS_CHANNEL_CRONJOB_UPDATED || 'cronjob:updated',
      cronJobDeleted: process.env.REDIS_CHANNEL_CRONJOB_DELETED || 'cronjob:deleted'
    }
  },
  api: {
    url: process.env.API_URL || 'http://127.0.0.1:3000/api',
    key: process.env.API_KEY || ''  // Must match WEBHOOK_API_KEY in Go API
  },
  cronJob: {
    fetchInterval: parseInt(process.env.CRONJOB_FETCH_INTERVAL || '300000'), // 5 minutes by default
    maxConcurrentJobs: parseInt(process.env.MAX_CONCURRENT_JOBS || '10'),
    timeout: parseInt(process.env.CRONJOB_TIMEOUT || '30000') // 30 seconds by default
  },
  logLevel: process.env.LOG_LEVEL || 'info'
};
