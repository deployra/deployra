import dotenv from 'dotenv';

dotenv.config();

export const config = {
  kubernetes: {
    configPath: process.env.KUBE_CONFIG_PATH || '~/.kube/config',
    labelSelector: 'managedBy=kubestrator',
  },
  api: {
    url: process.env.API_URL || 'http://127.0.0.1:3000/api',
    key: process.env.API_KEY || ''  // Must match WEBHOOK_API_KEY in Go API
  },
  metrics: {
    resourceCollectionIntervalSeconds: parseInt(process.env.METRICS_RESOURCE_COLLECTION_INTERVAL_SECONDS || '60', 10),
    storageCollectionIntervalSeconds: parseInt(process.env.METRICS_STORAGE_COLLECTION_INTERVAL_SECONDS || '300', 10),
    enabled: process.env.METRICS_COLLECTION_ENABLED !== 'false'
  },
  logLevel: process.env.LOG_LEVEL || 'info'
};