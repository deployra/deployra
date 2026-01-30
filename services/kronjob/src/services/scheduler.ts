import { schedule, ScheduledTask } from 'node-cron';
import { CronJob, CronJobDeletedEvent, CronJobExecution } from '../types';
import { logger } from '../utils/logger';
import { apiService } from './api';
import { config } from '../config';

class SchedulerService {
  private cronJobs: Map<string, { job: CronJob; scheduler: ScheduledTask }> = new Map();
  private executionHistory: CronJobExecution[] = [];
  private runningJobs: Set<string> = new Set();

  constructor() {
    // Periodically clean up execution history (keep last 1000 executions)
    setInterval(() => {
      if (this.executionHistory.length > 1000) {
        this.executionHistory = this.executionHistory.slice(-1000);
      }
    }, 3600000); // Every hour
  }

  async initialize() {
    try {
      const jobs = await apiService.getAllCronJobs();
      jobs.forEach(job => {
        if (job.enabled) {
          this.addJob(job);
        }
      });
      logger.info(`Initialized scheduler with ${this.cronJobs.size} jobs`);
    } catch (error) {
      logger.error(`Failed to initialize scheduler: ${error}`);
    }
  }

  addJob(job: CronJob) {
    try {
      if (this.cronJobs.has(job.id)) {
        this.removeJob(job.id);
      }

      if (!job.enabled) {
        logger.info(`Skipping disabled job: ${job.id}`);
        return;
      }

      // Validate cron expression
      if (!this.isValidCronExpression(job.schedule)) {
        logger.error(`Invalid cron expression for job ${job.id}: ${job.schedule}`);
        return;
      }

      const scheduler = schedule(job.schedule, () => {
        this.executeJob(job);
      });

      this.cronJobs.set(job.id, { job, scheduler });
      logger.info(`Added job to scheduler: ${job.id}`);
    } catch (error) {
      logger.error(`Error adding job to scheduler: ${error}`);
    }
  }

  updateJob(job: CronJob) {
    try {
      this.removeJob(job.id);
      this.addJob(job);
      logger.info(`Updated job in scheduler: ${job.id}`);
    } catch (error) {
      logger.error(`Error updating job in scheduler: ${error}`);
    }
  }

  removeJob(jobId: string) {
    try {
      const existingJob = this.cronJobs.get(jobId);
      if (existingJob) {
        existingJob.scheduler.stop();
        this.cronJobs.delete(jobId);
        logger.info(`Removed job from scheduler: ${jobId}`);
      }
    } catch (error) {
      logger.error(`Error removing job from scheduler: ${error}`);
    }
  }

  private async executeJob(job: CronJob) {
    // Check if we've reached the maximum number of concurrent jobs
    if (this.runningJobs.size >= config.cronJob.maxConcurrentJobs) {
      logger.warn(`Skipping job execution due to concurrency limit: ${job.id}`);
      return;
    }

    // Check if this job is already running
    if (this.runningJobs.has(job.id)) {
      logger.warn(`Job is already running, skipping execution: ${job.id}`);
      return;
    }

    const execution: CronJobExecution = {
      cronJobId: job.id,
      startTime: new Date(),
      status: 'running'
    };

    this.executionHistory.push(execution);
    this.runningJobs.add(job.id);

    try {
      logger.info(`Executing job: ${job.id}`);
      
      // Calculate next run time based on the cron schedule
      const nextRunAt = this.calculateNextRunTime(job.schedule);
      
      // Execute the job
      // job.projectId is kubernetes namespace
      // job.serviceId is kubernetes service name
      const url = `http://${job.serviceId}-service.${job.projectId}.svc.cluster.local${job.path}`;
      const result = await apiService.executeRequest(url, job.headers);
      
      // Update execution record
      execution.endTime = new Date();
      execution.status = result.statusCode >= 200 && result.statusCode < 300 ? 'success' : 'failed';
      execution.statusCode = result.statusCode;
      execution.response = result.response;

      // Update job status in the dashboard
      await apiService.updateCronJobExecutionStatus(
        job.id, 
        execution.startTime, 
        nextRunAt,
        execution.status,
        execution.statusCode,
        execution.response,
        execution.error
      );

      logger.info(`Job execution completed: ${job.id}`);
    } catch (error: any) {
      execution.endTime = new Date();
      execution.status = 'failed';
      execution.error = error.message;
      
      logger.error(`Job execution failed: ${job.id}`, { 
        error, 
        jobId: job.id,
        duration: execution.endTime.getTime() - execution.startTime.getTime()
      });
    } finally {
      this.runningJobs.delete(job.id);
    }
  }

  private isValidCronExpression(expression: string): boolean {
    // Special cases for common expressions
    const specialCases = [
      '@yearly', '@annually', '@monthly', '@weekly', '@daily',
      '@midnight', '@hourly', '@reboot'
    ];
    
    if (specialCases.includes(expression)) {
      return true;
    }
    
    try {
      // Try to create a schedule with the expression
      // If it's invalid, it will throw an error
      const task = schedule(expression, () => {});
      task.stop(); // Clean up the task
      return true;
    } catch (error) {
      return false;
    }
  }

  private calculateNextRunTime(cronExpression: string): Date | null {
    try {
      // Handle special expressions
      const now = new Date();
      let nextDate: Date;
      
      switch (cronExpression) {
        case '@yearly':
        case '@annually':
          nextDate = new Date(now.getFullYear() + 1, 0, 1, 0, 0, 0);
          break;
        case '@monthly':
          nextDate = new Date(now.getFullYear(), now.getMonth() + 1, 1, 0, 0, 0);
          break;
        case '@weekly':
          nextDate = new Date(now);
          nextDate.setDate(now.getDate() + (7 - now.getDay()));
          nextDate.setHours(0, 0, 0, 0);
          break;
        case '@daily':
        case '@midnight':
          nextDate = new Date(now);
          nextDate.setDate(now.getDate() + 1);
          nextDate.setHours(0, 0, 0, 0);
          break;
        case '@hourly':
          nextDate = new Date(now);
          nextDate.setHours(now.getHours() + 1, 0, 0, 0);
          break;
        case '@reboot':
          return null; // No next run time for @reboot
        default:
          // For standard cron expressions, we need to manually calculate the next run time
          // Parse the cron expression
          const parts = cronExpression.split(' ');
          if (parts.length !== 5) {
            throw new Error('Invalid cron expression format');
          }
          
          // Start with the current time
          nextDate = new Date(now);
          
          // Set seconds to 0
          nextDate.setSeconds(0);
          
          // Add 1 minute to ensure we get the next occurrence
          nextDate.setMinutes(nextDate.getMinutes() + 1);
          
          // Create a temporary task to check if the date matches
          let foundNext = false;
          let maxIterations = 1000; // Safety limit
          
          while (!foundNext && maxIterations > 0) {
            // Try to create a schedule with the expression
            try {
              const task = schedule(cronExpression, () => {});
              
              // Check if this task would run at the calculated time
              // This is a simplified approach - in a real implementation,
              // you would need to properly parse the cron expression and check each part
              
              // For now, we'll just advance time until we find a match
              task.stop();
              foundNext = true;
              return nextDate;
            } catch (error) {
              // If invalid for this time, try the next minute
              nextDate.setMinutes(nextDate.getMinutes() + 1);
              maxIterations--;
            }
          }
          
          if (!foundNext) {
            throw new Error('Could not determine next run time');
          }
          
          return nextDate;
      }
      
      // Return the calculated next date for special expressions
      return nextDate;
    } catch (error) {
      logger.error(`Error calculating next run time: ${error}`);
      return null;
    }
  }

  getJobStatus(jobId: string) {
    const job = this.cronJobs.get(jobId);
    if (!job) {
      return null;
    }

    const isRunning = this.runningJobs.has(jobId);
    const recentExecutions = this.executionHistory
      .filter(exec => exec.cronJobId === jobId)
      .sort((a, b) => b.startTime.getTime() - a.startTime.getTime())
      .slice(0, 10);

    return {
      job: job.job,
      isRunning,
      recentExecutions
    };
  }

  getAllJobs() {
    return Array.from(this.cronJobs.values()).map(({ job }) => job);
  }

  getExecutionHistory(jobId?: string, limit = 100) {
    let history = [...this.executionHistory];
    
    if (jobId) {
      history = history.filter(exec => exec.cronJobId === jobId);
    }
    
    return history
      .sort((a, b) => b.startTime.getTime() - a.startTime.getTime())
      .slice(0, limit);
  }

  handleCronJobAdded(job: CronJob) {
    this.addJob(job);
  }

  handleCronJobUpdated(job: CronJob) {
    this.updateJob(job);
  }

  handleCronJobDeleted(event: CronJobDeletedEvent) {
    this.removeJob(event.id);
  }
}

export const schedulerService = new SchedulerService();
