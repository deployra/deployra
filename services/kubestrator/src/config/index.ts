import dotenv from 'dotenv';

dotenv.config();

export const config = {
  redis: {
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT || '6379'),
    username: process.env.REDIS_USERNAME || '',
    password: process.env.REDIS_PASSWORD || '',
    queueName: process.env.REDIS_QUEUE_NAME || 'deployment-queue',
  },
  // Redis for deployment status (shared with web-proxy)
  statusRedis: {
    host: process.env.STATUS_REDIS_HOST || 'redis',
    port: parseInt(process.env.STATUS_REDIS_PORT || '6379'),
    password: process.env.STATUS_REDIS_PASSWORD || '',
    db: parseInt(process.env.STATUS_REDIS_DB || '0'),
  },
  aws: {
    region: process.env.AWS_REGION || 'us-east-1',
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY
  },
  kubernetes: {
    configPath: process.env.KUBE_CONFIG_PATH || '~/.kube/config',
  },
  api: {
    url: process.env.API_URL || 'http://127.0.0.1:3000/api',
    key: process.env.API_KEY || ''  // Must match WEBHOOK_API_KEY in Go API
  },
  // CrashLoopBackOff cleanup configuration
  crashLoopCleanup: {
    enabled: process.env.CRASHLOOP_CLEANUP_ENABLED === 'true',
    checkIntervalMinutes: parseInt(process.env.CRASHLOOP_CHECK_INTERVAL_MINUTES || '15'),
    minRestartCount: parseInt(process.env.CRASHLOOP_MIN_RESTART_COUNT || '5'),
  },
  // Privileged services that need Kubernetes service account access
  // These services get enableServiceLinks and automountServiceAccountToken enabled
  privilegedServices: {
    serviceIds: (process.env.PRIVILEGED_SERVICE_IDS || '').split(',').filter(Boolean),
  },
  logLevel: process.env.LOG_LEVEL || 'info'
};
