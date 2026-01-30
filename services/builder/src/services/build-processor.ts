import Redis from 'ioredis';
import path from 'path';
import fs from 'fs';
import { config } from '../config';
import { logger } from '../utils/logger';
import { GitService } from './git-service';
import { ImageBuilder, CommandOutput } from './image-builder';
import { ECRService } from './ecr-service';
import { DeploymentStatus } from '../types';
import * as dashboardApi from '../utils/dashboard-api';
import { DeploymentQueueItem } from '../types';

export class BuildProcessor {
  private redisDeploymentQueue: Redis; // Separate Redis client for blocking operations
  private redisCancelSubscriber: Redis; // Separate Redis client for cancellation events
  private gitService: GitService;
  private imageBuilder: ImageBuilder;
  private ecrService: ECRService;
  private isProcessingDeployment: boolean = false; // Track if we're currently processing a deployment
  private shouldStop: boolean = false; // Signal to stop after current deployment
  private currentDeploymentId: string | null = null; // Track the ID of the currently processing deployment
  private currentDeploymentAbortController: AbortController | null = null; // For aborting current deployment

  constructor() {
    // Initialize Redis clients
    this.redisDeploymentQueue = new Redis({
      host: config.redis.host,
      port: config.redis.port,
      username: config.redis.username,
      password: config.redis.password,
      retryStrategy: (times) => {
        logger.info(`Redis subscription connection lost, attempting to reconnect in 3000ms...`);
        return 3000;
      }
    });
    
    this.redisCancelSubscriber = new Redis({
      host: config.redis.host,
      port: config.redis.port,
      username: config.redis.username,
      password: config.redis.password,
      retryStrategy: (times) => {
        logger.info(`Redis subscription connection lost, attempting to reconnect in 3000ms...`);
        return 3000;
      }
    });
    
    // Set up subscription to the cancellation channel
    this.redisCancelSubscriber.subscribe(config.redis.cancelChannelName);
    this.redisCancelSubscriber.on('message', this.handleCancellationMessage.bind(this));
    
    // Initialize services
    this.gitService = new GitService();
    this.imageBuilder = new ImageBuilder();
    this.ecrService = new ECRService();
    
    logger.info('Build processor initialized');
  }
  
  async startProcessing(): Promise<void> {
    try {
      logger.info(`Starting to process build queue: ${config.redis.queueName}`);
      this.shouldStop = false;
      
      // Start processing the queue
      while (!this.shouldStop) {
        try {
          // Get the next deployment request from Redis with a timeout
          // Using a 1 second timeout allows for graceful shutdown
          const result = await this.redisDeploymentQueue.blpop(config.redis.queueName, 1);

          // If we got a result, process it
          if (result && result[1]) {
            // Parse the deployment request
            const deploymentRequest = JSON.parse(result[1]) as DeploymentQueueItem;
            logger.info(`Received deployment request for deployment: ${deploymentRequest.deploymentId}`);
            
            // Process the deployment
            await this.processDeployment(deploymentRequest);
          }
        } catch (error) {
          // Await 1 second before retrying
          await new Promise(resolve => setTimeout(resolve, 1000));
          logger.error('Error processing event:', error);
        }
      }
      
      logger.info('Build processing loop stopped');
    } catch (error) {
      logger.error('Fatal error in build processor:', error);
      throw error;
    }
  }
  
  async processDeployment(request: DeploymentQueueItem): Promise<void> {
    // Create a new AbortController for this deployment
    this.currentDeploymentAbortController = new AbortController();
    const signal = this.currentDeploymentAbortController.signal;
    
    // Variable to store the working directory path
    let workDir: string | undefined;
    
    // Setup an abort handler to throw an error when cancelled
    signal.addEventListener('abort', () => {
      logger.info(`Build ${request.deploymentId} aborted by cancellation signal`);
    });
    
    try {
      // Mark that we're processing a deployment
      this.isProcessingDeployment = true;
      this.currentDeploymentId = request.deploymentId;
      
      logger.info(`Processing build ${request.deploymentId} for service ${request.serviceId}`);
      
      // Update deployment status to BUILDING
      await dashboardApi.updateDeploymentStatus({
        deploymentId: request.deploymentId,
        status: DeploymentStatus.BUILDING,
        logs: {
          text: `Starting build process for ${request.repositoryName}:${request.branch}`,
          type: "INFO"
        }
      });
      
      // Check if the deployment has been cancelled before we start
      if (signal.aborted) {
        logger.info(`Build ${request.deploymentId} was cancelled, stopping processing`);
        // We intentionally don't send a status update to the API for aborted deployments
        // as the client cancellation already handles this state
        return;
      }
      
      // Construct repository URL from GitHub account details
      let repoUrl = "";
      if (request.gitProvider.type === "GITHUB" || request.gitProvider.type === "github") {
        const { githubAccount } = request.gitProvider;
        repoUrl = `https://${githubAccount.username}:${githubAccount.accessToken}@github.com/${request.repositoryName}.git`;
      } else if (request.gitProvider.type === "CUSTOM" || request.gitProvider.type === "custom") {
        const { url, username, password } = request.gitProvider;
        if (!url || !username || !password) {
          throw new Error("Missing required Git provider credentials");
        }

        repoUrl = url.replace(
          /^(https?:\/\/)/, 
          `$1${encodeURIComponent(username)}:${encodeURIComponent(password)}@`
        ) + `/${request.repositoryName}.git`;
      } else {
        throw new Error("Invalid Git provider type");
      }
      
      // Function to check for cancellation during processing
      const checkCancellation = async (): Promise<boolean> => {
        if (signal.aborted) {
          logger.info(`Build ${request.deploymentId} was cancelled during processing`);
          // We intentionally don't send a status update to the API for aborted deployments
          // as the client cancellation already handles this state
          return true;
        }
        return false;
      };
      
      // Step 1: Clone the repository
      logger.info(`Cloning repository: ${request.repositoryName} branch: ${request.branch}`);
      await dashboardApi.updateDeploymentLogs({
        deploymentId: request.deploymentId,
        text: `Cloning repository: ${request.repositoryName} branch: ${request.branch}`
      });

      workDir = await this.gitService.cloneRepository(
        repoUrl,
        request.branch,
        request.deploymentId
      );
      
      // Check for cancellation after repository clone
      if (await checkCancellation()) return;
      
      // Step 1.1: If a specific commit SHA is provided, checkout that commit
      if (request.commitSha) {
        logger.info(`Checking out commit: ${request.commitSha}`);
        await dashboardApi.updateDeploymentLogs({
          deploymentId: request.deploymentId,
          text: `Checking out commit: ${request.commitSha}`
        });
        
        await this.gitService.checkoutCommit(workDir, request.commitSha);
        logger.info(`Checked out specific commit: ${request.commitSha}`);
      }
      
      // Check for cancellation before Docker build
      if (await checkCancellation()) return;
      
      // Save env variables to the .env file in the folder
      if (request.environmentVariables && request.environmentVariables.length > 0) {
        logger.info(`Saving environment variables to .env file`);
        await dashboardApi.updateDeploymentLogs({
          deploymentId: request.deploymentId,
          text: `Saving environment variables to .env file`
        });
        
        const envFilePath = path.join(workDir, '.env');
        let envContent = '';
        
        // Convert environment variables object to .env file format
        for (const { key, value } of request.environmentVariables) {
          envContent += `${key}=${value}\n`;
        }
        
        // Write to .env file
        fs.writeFileSync(envFilePath, envContent);
        logger.info(`Environment variables saved to .env file`);
        await dashboardApi.updateDeploymentLogs({
          deploymentId: request.deploymentId,
          text: `Environment variables saved to .env file`
        });
      } else {
        logger.info(`No environment variables to save`);
        await dashboardApi.updateDeploymentLogs({
          deploymentId: request.deploymentId,
          text: `No environment variables to save`
        });
      }
      
      // Step 1.3: Create or update .dockerignore file
      logger.info(`Creating/updating .dockerignore file to prevent including files outside project directory`);
      await dashboardApi.updateDeploymentLogs({
        deploymentId: request.deploymentId,
        text: `Creating/updating .dockerignore file to prevent including files outside project directory`
      });
      
      const dockerignorePath = path.join(workDir, '.dockerignore');
      const dockerignoreContent = `# Ignore git directories
.git
.github
.gitignore

# Ignore node modules and package files (will be installed fresh in container)
node_modules
npm-debug.log
yarn-debug.log
yarn-error.log

# Ignore environment and secret files
.env.local
.env.development
.env.test
.env.production
*.pem
*.key

# Ignore development and temporary files
.DS_Store
*.log
logs
tmp
temp
*.tmp
*.temp

# Ignore test files and coverage reports
__tests__
test
tests
coverage
.nyc_output

# Ignore docker files themselves (prevent recursive copying)
Dockerfile*
docker-compose*
.docker

## Prevent accessing parent directories
../
../*
/..
**/..

# IDE specific files
.idea
.vscode
*.sublime-*
*.swp
.editorconfig

# System files
.DS_Store
Thumbs.db`;

      // Check if .dockerignore already exists
      if (fs.existsSync(dockerignorePath)) {
        // Read existing content
        const existingContent = fs.readFileSync(dockerignorePath, 'utf8');
        
        // Check if it already has parent directory protection
        if (!existingContent.includes('../') && !existingContent.includes('../*')) {
          // Append our parent directory protection rules to existing content
          const updatedContent = existingContent + '\n\n# Prevent accessing parent directories\n../\n../*\n/..\n**/..';
          fs.writeFileSync(dockerignorePath, updatedContent);
          logger.info(`Updated existing .dockerignore file with parent directory protection`);
        } else {
          logger.info(`Existing .dockerignore file already has parent directory protection`);
        }
      } else {
        // Create new .dockerignore file
        fs.writeFileSync(dockerignorePath, dockerignoreContent);
        logger.info(`Created new .dockerignore file`);
      }
      
      // Step 2: Build Docker image
      const imageName = `${request.serviceId}`;
      // We still need to pass imageTag to the buildImage method for compatibility
      // but it won't be used in the actual build command
      // const imageTag = request.commitSha.substring(0, 8); 
      
      logger.info(`Building Docker image: ${imageName}`);
      await dashboardApi.updateDeploymentLogs({
        deploymentId: request.deploymentId,
        text: `Building Docker image: ${imageName}`
      });
      
      const builtImage = await this.imageBuilder.buildImage(
        workDir,
        imageName,
        "",
        request.runtimeFilePath ? request.runtimeFilePath : undefined,
        request.ports,
        async ({ source, data }: CommandOutput) => {
          await dashboardApi.updateDeploymentLogs({ deploymentId: request.deploymentId, text: data });
        },
        signal // Pass the AbortSignal to allow cancellation during build
      );

      // Check for cancellation after Docker build
      if (await checkCancellation()) return;
      
      // Update status to BUILDING
      await dashboardApi.updateDeploymentStatus({
        deploymentId: request.deploymentId,
        status: DeploymentStatus.BUILDING,
        logs: {
          text: `Docker image built successfully, preparing to push`,
          type: "INFO"
        }
      });
      
      // Determine ECR repository name (using service ID as fallback if needed)
      const ecrRepositoryName = "deployra/" + request.serviceId;
      
      // Check for cancellation before pushing to ECR
      if (await checkCancellation()) return;
      
      // Step 3: Push Docker image to ECR
      logger.info(`Creating ECR repository if needed: ${ecrRepositoryName}`);
      await dashboardApi.updateDeploymentLogs({
        deploymentId: request.deploymentId,
        text: `Creating ECR repository if needed: ${ecrRepositoryName}`
      });
      
      await this.ecrService.createRepositoryIfNotExists(ecrRepositoryName);
      
      // Check for cancellation before pushing to ECR
      if (await checkCancellation()) return;

      logger.info(`Pushing image to ECR: ${imageName} -> ${ecrRepositoryName}`);
      await dashboardApi.updateDeploymentLogs({
        deploymentId: request.deploymentId,
        text: `Pushing image to ECR: ${imageName} -> ${ecrRepositoryName}`
      });
      
      // Check for cancellation before pushing to ECR
      if (await checkCancellation()) return;

      const ecrImageUri = await this.ecrService.pushImageToECR(
        imageName,
        "",
        ecrRepositoryName,
        async ({ source, data }: CommandOutput) => {
          await dashboardApi.updateDeploymentLogs({ deploymentId: request.deploymentId, text: data });
        }
      );

      // Clean up Docker resources
      await this.imageBuilder.clean();
      
      // Check for cancellation before updating deployment status
      if (await checkCancellation()) return;
      
      // Mark the deployment as built successfully
      logger.info(`Build successful. Image URI: ${ecrImageUri}`);

      await dashboardApi.updateDeploymentStatus({
        deploymentId: request.deploymentId,
        status: DeploymentStatus.BUILDED,
        logs: {
          text: `Build completed successfully. Image is ready for deployment.`,
          type: "INFO"
        },
        data: {
          containerImageUri: ecrImageUri,
          containerRegistryType: "ecr"
        }
      });

      logger.info(`Build for deployment ${request.deploymentId} completed successfully`);
    } catch (error) {
      logger.error(`Error processing deployment ${request.deploymentId}:`, error);
      
      // Check if this was an abort error
      if (signal.aborted) {
        logger.info(`Deployment ${request.deploymentId} was cancelled during an operation`);
        // We intentionally don't send a status update to the API for aborted deployments
        // as the client cancellation already handles this state
      } else {
        // Regular error handling
        const errorMessage = error instanceof Error 
          ? error.message 
          : 'Unknown error during deployment';
        
        logger.error(`Deployment failed: ${errorMessage}`);

        await dashboardApi.updateDeploymentStatus({
          deploymentId: request.deploymentId,
          status: DeploymentStatus.FAILED,
          logs: {
            text: `${errorMessage}`,
            type: "ERROR"
          },
          error: errorMessage
        });
      }
    } finally {
      // Clean up the work directory
      if (workDir) {
        this.cleanupWorkDir(workDir);
      }
      
      // Mark that we're no longer processing a deployment
      this.isProcessingDeployment = false;
      this.currentDeploymentId = null;
      this.currentDeploymentAbortController = null;
      logger.info(`Finished processing build ${request.deploymentId}`);
    }
  }
  
  async stop(): Promise<void> {
    try {
      logger.info('Stopping build processor');
      
      // If we're currently processing a deployment, abort it
      if (this.isProcessingDeployment && this.currentDeploymentAbortController) {
        logger.info(`Aborting in-progress deployment ${this.currentDeploymentId}`);
        this.currentDeploymentAbortController.abort();
      }
      
      // Close Redis connections
      this.redisDeploymentQueue.disconnect();
      this.redisCancelSubscriber.disconnect();
      logger.info('Redis connections closed successfully');
    } catch (error) {
      logger.error('Error stopping build processor:', error);
    }
  }

  private cleanupWorkDir(workDir: string): void {
    logger.info(`Cleaning up git working directory: ${workDir}`);
    try {
      if (fs.existsSync(workDir)) {
        // Completely remove the directory and all its contents
        fs.rmSync(workDir, { recursive: true, force: true });
        logger.info(`Completely removed working directory: ${workDir}`);
      }
    } catch (error) {
      logger.warn(`Failed to clean up working directory ${workDir}:`, error);
    }
  }
  
  private async handleCancellationMessage(channel: string, message: string): Promise<void> {
    try {
      const data = JSON.parse(message);
      const deploymentId = data.deploymentId;
      
      if (!deploymentId) {
        logger.warn('Received cancellation message without deploymentId');
        return;
      }
      
      logger.info(`Received cancellation for deployment: ${deploymentId}`);
      
      // Only abort if this is the currently processing deployment
      if (this.currentDeploymentId === deploymentId && this.currentDeploymentAbortController) {
        logger.info(`Aborting active deployment ${deploymentId} immediately due to cancellation request`);
        
        // Abort the deployment process immediately
        this.currentDeploymentAbortController.abort();
        
        // Update the deployment status to failed/cancelled via API
        await dashboardApi.updateDeploymentStatus({
          deploymentId: deploymentId,
          status: DeploymentStatus.CANCELLED,
          logs: {
            text: 'Deployment cancelled by user',
            type: "ERROR"
          }
        });
      } else {
        // Log that we received a cancellation for a deployment we're not currently processing
        logger.info(`Received cancellation for build ${deploymentId}, but it's not currently being processed`);
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
      logger.error(`Error handling cancellation message: ${errorMessage}`, error);
    }
  }
}
