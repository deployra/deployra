import { BuildProcessor } from './services/build-processor';
import { logger } from './utils/logger';
import { ensureWorkDirExists, cleanupOldDeployments } from './utils/file-system';

async function main() {
  try {
    logger.info('Starting deployment builder service');
    
    // Ensure working directory exists and clean up old deployments
    ensureWorkDirExists();
    cleanupOldDeployments();
    
    // Create and start deployment processor
    const processor = new BuildProcessor();
    
    let isShuttingDown = false;

    process.on('SIGINT', async () => {
      // Prevent multiple shutdown attempts
      if (isShuttingDown) {
        logger.warn('Shutdown already in progress, please wait...');
        return;
      }
      
      isShuttingDown = true;
      logger.info('Received SIGINT, shutting down gracefully');
      
      try {
        await processor.stop();
        logger.info('Exiting process after graceful shutdown 1');
        
        // Force exit after a short timeout if still running
        const forceExitTimeout = setTimeout(() => {
          logger.warn('Forcing process exit after timeout');
          process.exit(0);
        }, 2000);
        
        // Clear the timeout if we exit naturally
        forceExitTimeout.unref();

        process.exit(0);
      } catch (error) {
        logger.error('Error during shutdown:', error);
        process.exit(1);
      }
    });

    process.on('SIGTERM', async () => {
      // Prevent multiple shutdown attempts
      if (isShuttingDown) {
        logger.warn('Shutdown already in progress, please wait...');
        return;
      }
      
      isShuttingDown = true;
      logger.info('Received SIGTERM, shutting down gracefully');
      
      try {
        await processor.stop();
        
        logger.info('Exiting process after graceful shutdown 2');
        
        // Force exit after a short timeout if still running
        const forceExitTimeout = setTimeout(() => {
          logger.warn('Forcing process exit after timeout');
          process.exit(0);
        }, 2000);
        
        // Clear the timeout if we exit naturally
        forceExitTimeout.unref();

        process.exit(0);
      } catch (error) {
        logger.error('Error during shutdown:', error);
        process.exit(1);
      }
    });

    // Catch unhandled promise rejections
    process.on('unhandledRejection', (reason, promise) => {
      // logger.error('Unhandled Promise Rejection:', reason);
      // Don't exit the process, but log it
    });
    
    // Start processing deployments
    await processor.startProcessing();
  } catch (error) {
    logger.error('Fatal error in main process:', error);
    process.exit(1);
  }
}

// Start the application
main().catch(error => {
  logger.error('Unhandled error in main process:', error);
  process.exit(1);
});
