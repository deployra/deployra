import axios from 'axios';
import { DeploymentStatus, ServiceStatus } from '../types';
import { config } from '../config';

const api = axios.create({
  baseURL: config.api.url,
  headers: {
    'Content-Type': 'application/json',
    'x-api-key': config.api.key
  }
});

export interface UpdateDeploymentStatusParams {
  deploymentId: string;
  status: DeploymentStatus;
  logs?: {
    text: string;
    type?: string;
  };
  error?: string;
  data?: {
    containerImageUri?: string;
    containerRegistryType?: 'ecr' | 'ghcr' | 'docker';
  };
}

export interface UpdateDeploymentLogsParams {
  deploymentId: string;
  text: string;
  type?: string;
}

export interface UpdateServiceStatusParams {
  serviceId: string;
  status: ServiceStatus;
}

/**
 * Update the status of a deployment
 */
export async function updateDeploymentStatus({ deploymentId, status, logs, error, data }: UpdateDeploymentStatusParams) {
  try {
    const response = await api.post(`/webhooks/deployments/${deploymentId}/status`, {
      status,
      error,
      logs,
      data
    });
    
    return response.data;
  } catch (error) {
    // console.error('Failed to update deployment status:', error);
    throw error;
  }
}

/**
 * Update the logs of a deployment
 */
export async function updateDeploymentLogs({ deploymentId, text, type }: UpdateDeploymentLogsParams) {
  try {
    const response = await api.post(`/webhooks/deployments/${deploymentId}/logs`, {
      text,
      type
    });
    return response.data;
  } catch (error) {
    // console.error('Failed to update deployment logs:', error);
    throw error;
  }
}

export async function updateServiceStatus({ serviceId, status }: UpdateServiceStatusParams) {
  try {
    const response = await api.post(`/webhooks/services/${serviceId}/status`, {
      status,
    });
    
    return response.data;
  } catch (error) {
    // console.error('Failed to update service status:', error);
    throw error;
  }
}

export default {
  updateDeploymentLogs,
  updateDeploymentStatus,
  updateServiceStatus
};
