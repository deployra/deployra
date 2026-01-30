import * as dotenv from 'dotenv';
import path from 'path';

dotenv.config();

// Get project root directory - assuming this file is in src/config
const projectRoot = path.resolve(__dirname, '..', '..');

export const config = {
  redis: {
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT || '6379'),
    username: process.env.REDIS_USERNAME || '',
    password: process.env.REDIS_PASSWORD || '',
    queueName: process.env.REDIS_QUEUE_NAME || 'builder-queue',
    cancelChannelName: process.env.REDIS_CANCEL_CHANNEL_NAME || 'builder:cancel'
  },
  aws: {
    region: process.env.AWS_REGION || 'us-east-1',
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY
  },
  deployment: {
    workDir: process.env.WORK_DIR || path.join(projectRoot, 'tmp', 'deployments')
  },
  api: {
    url: process.env.API_URL || 'http://127.0.0.1:3000/api',
    key: process.env.API_KEY || ''  // Must match WEBHOOK_API_KEY in Go API
  },
  logLevel: process.env.LOG_LEVEL || 'info'
};
