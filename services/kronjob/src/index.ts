import { logger } from './utils/logger';
import { redisService } from './services/redis';
import { schedulerService } from './services/scheduler';
import { config } from './config';

class KronJobService {
  private isShuttingDown = false;

  async start() {
    try {
      logger.info('Starting KronJob service');
      
      // Set up Redis event handlers
      this.setupRedisHandlers();
      
      // Initialize the scheduler with existing jobs
      await schedulerService.initialize();
      
      // Set up periodic refresh of all jobs
      this.setupPeriodicRefresh();
      
      // Set up graceful shutdown
      this.setupGracefulShutdown();
      
      logger.info('KronJob service started successfully');
    } catch (error) {
      logger.error('Failed to start KronJob service', { error });
      process.exit(1);
    }
  }

  private setupRedisHandlers() {
    redisService.onCronJobAdded((job) => {
      logger.info('Received new CronJob', { jobId: job.id });
      schedulerService.handleCronJobAdded(job);
    });

    redisService.onCronJobUpdated((job) => {
      logger.info('Received updated CronJob', { jobId: job.id });
      schedulerService.handleCronJobUpdated(job);
    });

    redisService.onCronJobDeleted((event) => {
      logger.info('Received CronJob deletion', { jobId: event.id });
      schedulerService.handleCronJobDeleted(event);
    });
  }

  private setupPeriodicRefresh() {
    // Periodically refresh all jobs to ensure we're in sync with the dashboard
    setInterval(async () => {
      if (this.isShuttingDown) return;
      
      try {
        logger.info('Performing periodic refresh of all CronJobs');
        await schedulerService.initialize();
      } catch (error) {
        logger.error('Error during periodic refresh', { error });
      }
    }, config.cronJob.fetchInterval);
  }

  private setupGracefulShutdown() {
    const shutdown = async () => {
      if (this.isShuttingDown) return;
      this.isShuttingDown = true;
      
      logger.info('Shutting down KronJob service');
      
      try {
        // Close Redis connections
        await redisService.disconnect();
        
        logger.info('KronJob service shut down successfully');
        process.exit(0);
      } catch (error) {
        logger.error('Error during shutdown', { error });
        process.exit(1);
      }
    };

    // Listen for termination signals
    process.on('SIGTERM', shutdown);
    process.on('SIGINT', shutdown);
  }
}

// Start the service
const service = new KronJobService();
service.start().catch((error) => {
  logger.error('Unhandled error in KronJob service', { error });
  process.exit(1);
});
