import axios from 'axios';
import { logger } from './logger';
import { config } from '../config';

// Create an axios instance with default configuration
const api = axios.create({
  baseURL: config.api.url,
  headers: {
    'Content-Type': 'application/json',
    'x-api-key': config.api.key
  }
});

// Pod phase and container states
export enum PodPhase {
  PENDING = "PENDING",
  RUNNING = "RUNNING",
  SUCCEEDED = "SUCCEEDED",
  FAILED = "FAILED",
  UNKNOWN = "UNKNOWN",
}

export enum ContainerState {
  WAITING = "WAITING",
  RUNNING = "RUNNING",
  TERMINATED = "TERMINATED",
}

export enum ContainerStateReason {
  // Waiting
  CRASH_LOOP_BACKOFF = "CRASH_LOOP_BACKOFF",
  IMAGE_PULL_BACKOFF = "IMAGE_PULL_BACKOFF",
  ERR_IMAGE_PULL = "ERR_IMAGE_PULL",
  CONTAINER_CREATING = "CONTAINER_CREATING",
  POD_INITIALIZING = "POD_INITIALIZING",

  // Terminated
  OOM_KILLED = "OOM_KILLED",
  COMPLETED = "COMPLETED",
  ERROR = "ERROR",

  // Other
  TERMINATING = "TERMINATING",
  CREATE_CONTAINER_ERROR = "CREATE_CONTAINER_ERROR",
}

export interface UpdatePodEventParams {
  eventType: string;
  podId: string;
  serviceId: string;
  deploymentId?: string;
  phase: PodPhase;
  containerState?: ContainerState;
  containerStateReason?: ContainerStateReason;
}

export enum ServiceStatus {
  PENDING = 'PENDING',
  BUILDING = 'BUILDING',
  DEPLOYING = 'DEPLOYING',
  DEPLOYED = 'DEPLOYED',
  FAILED = 'FAILED'
}

export enum ScalingReason {
  MANUAL = 'MANUAL',
  HPA_CPU_UTILIZATION = 'HPA_CPU_UTILIZATION',
  HPA_MEMORY_UTILIZATION = 'HPA_MEMORY_UTILIZATION',
  HPA_CUSTOM_METRIC = 'HPA_CUSTOM_METRIC',
  DEPLOYMENT_ROLLOUT = 'DEPLOYMENT_ROLLOUT',
  UNKNOWN = 'UNKNOWN'
}

export interface UpdateReplicaCountParams {
  serviceId: string;
  currentReplicas: number;
  targetReplicas: number;
  deploymentId?: string;
  scalingReason?: ScalingReason;
  scalingMessage?: string;
}

export interface PodMetrics {
  podId: string;
  cpuUsage: number;      // CPU usage in millicores (m)
  cpuLimit?: number;     // CPU limit in millicores (m)
  memoryUsage: number;   // Memory usage in bytes
  memoryLimit?: number;  // Memory limit in bytes
}

export interface StorageMetrics {
  serviceId: string;
  pvcs: {
    name: string;
    storageUsage: number;
    storageLimit?: number;
    storageUtilizationPercentage?: number;
  }[];
}

export interface ServiceMetrics {
  serviceId: string;
  deploymentId?: string;
  totalCpuUsage: number;      // Total CPU usage across all pods in millicores (m)
  avgCpuUsage: number;        // Average CPU usage per pod in millicores (m)
  totalMemoryUsage: number;   // Total memory usage across all pods in bytes
  avgMemoryUsage: number;     // Average memory usage per pod in bytes
  totalStorageUsage?: number; // Total storage usage across all pods in bytes
  avgStorageUsage?: number;   // Average storage usage per pod in bytes
  cpuUtilizationPercentage?: number;  // CPU usage as percentage of limit (if limits are set)
  memoryUtilizationPercentage?: number; // Memory usage as percentage of limit (if limits are set)
  storageUtilizationPercentage?: number; // Storage usage as percentage of limit (if limits are set)
  pods: PodMetrics[];         // Individual pod metrics for this service
}

/**
 * Send pod event (start/stop) to the dashboard API
 */
export async function updatePodEvent({ eventType, podId, serviceId, deploymentId, phase, containerState, containerStateReason }: UpdatePodEventParams) {
  try {
    const response = await api.post(`/webhooks/services/${serviceId}/pods`, {
      eventType,
      podId,
      deploymentId,
      phase,
      containerState,
      containerStateReason,
      timestamp: new Date().toISOString()
    });
    
    // logger.info(`Reported pod ${action} event for ${podId}`);
    return response.data;
  } catch (error) {
    // logger.error('Failed to update pod event:', error);
    throw error;
  }
}

/**
 * Update service replica count in the dashboard API
 */
export async function updateServiceReplicaCount({ serviceId, currentReplicas, targetReplicas, deploymentId, scalingReason, scalingMessage }: UpdateReplicaCountParams) {
  try {
    const response = await api.post(`/webhooks/services/${serviceId}/replicas`, {
      currentReplicas,
      targetReplicas,
      deploymentId,
      scalingReason,
      scalingMessage,
      timestamp: new Date().toISOString()
    });
    
    logger.info(`Updated replica count for service ${serviceId}: current=${currentReplicas}, target=${targetReplicas}, reason=${scalingReason || 'UNKNOWN'}`);
    return response.data;
  } catch (error) {
    // logger.error('Failed to update service replica count:', error);
    throw error;
  }
}

/**
 * Send aggregated service metrics (CPU and memory usage) to the dashboard API
 * This includes both service-level aggregated metrics and individual pod metrics
 */
export async function updateServiceMetrics(serviceMetrics: ServiceMetrics[]) {
  if (!serviceMetrics || serviceMetrics.length === 0) {
    logger.debug('No service metrics to send');
    return;
  }

  try {
    // Send all metrics in a single bulk request
    await api.post('/webhooks/service-metrics', {
      metrics: serviceMetrics,
      timestamp: new Date().toISOString()
    });
    
    // logger.info(`Successfully sent metrics for ${serviceMetrics.length} services`);
  } catch (error) {
    // logger.error('Failed to update service metrics:', error);
    throw error;
  }
}

/**
 * Send storage metrics (PVC usage) to the dashboard API
 * This includes both service-level aggregated metrics and individual PVC metrics
 */
export async function updateStorageMetrics(storageMetrics: StorageMetrics[]) {
  if (!storageMetrics || storageMetrics.length === 0) {
    logger.debug('No storage metrics to send');
    return;
  }

  try {
    // Send all metrics in a single bulk request
    await api.post('/webhooks/storage-metrics', {
      metrics: storageMetrics,
      timestamp: new Date().toISOString()
    });
    
    logger.info(`Successfully sent storage metrics for ${storageMetrics.length} services`);
  } catch (error) {
    // logger.error('Failed to update storage metrics:', error);
    throw error;
  }
}