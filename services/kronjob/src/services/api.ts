import axios from 'axios';
import { config } from '../config';
import { logger } from '../utils/logger';
import { ApiResponse, CronJob } from '../types';

class ApiService {
  private client = axios.create({
    baseURL: config.api.url,
    headers: {
      'x-api-key': config.api.key,
      'Content-Type': 'application/json'
    },
    timeout: 10000
  });

  async getAllCronJobs(): Promise<CronJob[]> {
    try {
      logger.info('Fetching all CronJobs from dashboard API');
      const response = await this.client.get<ApiResponse<CronJob[]>>('/webhooks/cronjob');
      
      if (response.data.status === 'error' || !response.data.data) {
        throw new Error(response.data.message || 'Failed to fetch CronJobs');
      }
      
      logger.info(`Successfully fetched ${response.data.data.length} CronJobs`);
      return response.data.data;
    } catch (error) {
      logger.error('Error fetching CronJobs from API', { error });
      throw error;
    }
  }

  async updateCronJobExecutionStatus(
    cronJobId: string, 
    lastRunAt: Date, 
    nextRunAt: Date | null,
    status?: 'success' | 'failed',
    statusCode?: number,
    responseText?: string,
    errorText?: string
  ): Promise<void> {
    try {
      logger.info(`Updating CronJob execution status for ${cronJobId}`, { cronJobId, lastRunAt });
      
      const requestPayload = {
        lastRunAt: lastRunAt.toISOString(),
        nextRunAt: nextRunAt ? nextRunAt.toISOString() : null,
        status,
        statusCode,
        response: responseText,
        error: errorText
      };
      
      const apiResponse = await this.client.post<ApiResponse<any>>(
        `/webhooks/cronjob/${cronJobId}/status`,
        requestPayload
      );
      
      if (apiResponse.data.status === 'error') {
        throw new Error(apiResponse.data.message || 'Failed to update CronJob status');
      }
      
      logger.info(`Successfully updated CronJob status for ${cronJobId}`);
    } catch (error) {
      logger.error(`Error updating CronJob status for ${cronJobId}`, { error, cronJobId });
      throw error;
    }
  }

  async executeRequest(
    url: string, 
    headers: Record<string, string> | null = null
  ): Promise<{ statusCode: number; response: string }> {
    try {      
      const requestHeaders = {
        ...(headers || {}),
        'User-Agent': 'Kronjob-Service/1.0'
      };

      logger.info(`Executing CronJob request to ${url}`);
      const response = await axios.get(url, { 
        headers: requestHeaders,
        timeout: config.cronJob.timeout
      });
      
      return {
        statusCode: response.status,
        response: typeof response.data === 'object' 
          ? JSON.stringify(response.data) 
          : String(response.data)
      };
    } catch (error: any) {
      logger.error(`Error executing CronJob request to ${url}`, { error });
      
      return {
        statusCode: error.response?.status || 500,
        response: error.message
      };
    }
  }
}

export const apiService = new ApiService();
