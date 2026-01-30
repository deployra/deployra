import AWS from 'aws-sdk';
import { spawn } from 'child_process';
import util from 'util';
import { config } from '../config';
import { logger } from '../utils/logger';
import { CommandOutput } from './image-builder';

const execPromise = util.promisify(require('child_process').exec);

export class ECRService {
  private ecr: AWS.ECR;
  
  constructor() {
    // Configure AWS credentials
    AWS.config.update({
      region: config.aws.region,
      accessKeyId: config.aws.accessKeyId,
      secretAccessKey: config.aws.secretAccessKey
    });
    
    this.ecr = new AWS.ECR();
  }
  
  async getAuthorizationToken(): Promise<{ username: string; password: string; proxyEndpoint: string }> {
    try {
      logger.info('Getting ECR authorization token');
      const data = await this.ecr.getAuthorizationToken().promise();
      
      if (!data.authorizationData || data.authorizationData.length === 0) {
        throw new Error('No authorization data returned from ECR');
      }
      
      const auth = data.authorizationData[0];
      
      // Add type check to ensure authorizationToken exists
      if (!auth.authorizationToken) {
        throw new Error('Authorization token is missing in ECR response');
      }
      
      // Check for proxyEndpoint existence
      if (!auth.proxyEndpoint) {
        throw new Error('Proxy endpoint is missing in ECR response');
      }
      
      const token = Buffer.from(auth.authorizationToken, 'base64').toString('ascii');
      const [username, password] = token.split(':');
      
      return {
        username,
        password,
        proxyEndpoint: auth.proxyEndpoint
      };
    } catch (error) {
      logger.error('Error getting ECR authorization token:', error);
      const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
      throw new Error(`Failed to get ECR authorization token: ${errorMessage}`);
    }
  }
  
  async loginToECR(onOutput?: (data: CommandOutput) => void): Promise<void> {
    try {
      logger.info('Logging in to ECR');
      const auth = await this.getAuthorizationToken();
      
      // Execute AWS ECR login command using spawn for real-time output
      await new Promise<void>((resolve, reject) => {
        // Docker login can accept password from stdin
        const loginProcess = spawn('docker', [
          'login',
          '--username', auth.username,
          '--password-stdin',
          auth.proxyEndpoint
        ]);
        
        // Write password to stdin and close the stream
        loginProcess.stdin.write(auth.password);
        loginProcess.stdin.end();
        
        let stdoutBuffer = '';
        let stderrBuffer = '';
        
        loginProcess.stdout.on('data', (data) => {
          const stdout = data.toString();
          
          const fullData = stdoutBuffer + stdout;
          const lines = fullData.split('\n');
          
          stdoutBuffer = lines.pop() || '';
          
          if (onOutput) {
            for (const line of lines) {
              if (line.trim()) {
                onOutput({ source: 'stdout', data: line });
              }
            }
          }
        });
        
        loginProcess.stderr.on('data', (data) => {
          const stderr = data.toString();
          
          // Append to buffer and split into lines
          const fullData = stderrBuffer + stderr;
          const lines = fullData.split('\n');

          // Last line may be incomplete, save to buffer
          stderrBuffer = lines.pop() || '';

          // Send each complete line to callback
          if (onOutput) {
            for (const line of lines) {
              if (line.trim()) { // Skip empty lines
                onOutput({ source: 'stderr', data: line });
              }
            }
          }
        });
        
        loginProcess.on('close', (code) => {
          // Process remaining lines in buffer
          if (stdoutBuffer && onOutput) {
            onOutput({ source: 'stdout', data: stdoutBuffer });
          }
          
          if (stderrBuffer && onOutput) {
            onOutput({ source: 'stderr', data: stderrBuffer });
          }
          
          if (code === 0) {
            logger.info('Successfully logged in to ECR');
            resolve();
          } else {
            reject(new Error(`ECR login failed with exit code ${code}`));
          }
        });
        
        loginProcess.on('error', (error) => {
          reject(error);
        });
      });
    } catch (error) {
      logger.error('Error logging in to ECR:', error);
      const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
      throw new Error(`Failed to login to ECR: ${errorMessage}`);
    }
  }
  
  async createRepositoryIfNotExists(repositoryName: string): Promise<string> {
    try {
      logger.info(`Checking if ECR repository exists: ${repositoryName}`);
      
      // Try to describe the repository to see if it exists
      try {
        const describeParams = {
          repositoryNames: [repositoryName]
        };
        const describeData = await this.ecr.describeRepositories(describeParams).promise();
        
        if (describeData.repositories && describeData.repositories.length > 0) {
          const repository = describeData.repositories[0];
          logger.info(`Repository already exists: ${repositoryName}`);
          return repository.repositoryUri || '';
        }
      } catch (error) {
        // Log the full error for debugging
        logger.debug('Error while checking repository:', error);
        
        // Check if this is a RepositoryNotFoundException by checking the error code
        // AWS errors have a 'code' property with the error type
        if (error && typeof error === 'object' && 'code' in error && error.code === 'RepositoryNotFoundException') {
          // This is the expected case for a non-existent repository
          logger.info(`Repository not found, will create it: ${repositoryName}`);
        } else {
          // This is an unexpected error, rethrow it
          throw error;
        }
      }
      
      // Create the repository
      const createParams = {
        repositoryName: repositoryName
      };
      
      const createData = await this.ecr.createRepository(createParams).promise();

      if (!createData.repository || !createData.repository.repositoryUri) {
        throw new Error('Repository URI not returned after creation');
      }

      // Add lifecycle policy to keep only 1 image
      try {
        await this.ecr.putLifecyclePolicy({
          repositoryName: repositoryName,
          lifecyclePolicyText: JSON.stringify({
            rules: [
              {
                rulePriority: 1,
                description: 'Keep only 1 image',
                selection: {
                  tagStatus: 'any',
                  countType: 'imageCountMoreThan',
                  countNumber: 1
                },
                action: {
                  type: 'expire'
                }
              }
            ]
          })
        }).promise();
        logger.info(`Lifecycle policy added to repository: ${repositoryName}`);
      } catch (policyError) {
        logger.warn(`Failed to add lifecycle policy to ${repositoryName}:`, policyError);
      }

      logger.info(`Successfully created ECR repository: ${repositoryName}`);
      return createData.repository.repositoryUri;
    } catch (error) {
      logger.error(`Error creating ECR repository ${repositoryName}:`, error);
      const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
      throw new Error(`Failed to create ECR repository`);
    }
  }

  async pushImageToECR(
    imageName: string, 
    imageTag: string, 
    repositoryName: string,
    onOutput?: (data: CommandOutput) => void
  ): Promise<string> {
    try {
      // First create the repository if it doesn't exist
      const repositoryUri = await this.createRepositoryIfNotExists(repositoryName);
      
      // Login to ECR
      await this.loginToECR(onOutput);
      
      // For both local and remote image, we use just the image name without tag as requested
      const localImage = `${imageName}`;
      const remoteImage = `${repositoryUri}`; // Removed imageTag as requested
      
      // Tag the image for ECR using spawn for real-time output
      logger.info(`Tagging image ${localImage} as ${remoteImage}`);
      
      await new Promise<void>((resolve, reject) => {
        const tagCommand = 'docker';
        const tagArgs = ['tag', localImage, remoteImage];
        
        const tagProcess = spawn(tagCommand, tagArgs);
        
        let stdoutBuffer = '';
        let stderrBuffer = '';
        
        tagProcess.stdout.on('data', (data) => {
          const stdout = data.toString();
          
          // Append to buffer and split into lines
          const fullData = stdoutBuffer + stdout;
          const lines = fullData.split('\n');

          // Last line may be incomplete, save to buffer
          stdoutBuffer = lines.pop() || '';

          // Send each complete line to callback
          if (onOutput) {
            for (const line of lines) {
              if (line.trim()) { // Skip empty lines
                onOutput({ source: 'stdout', data: line });
              }
            }
          }
        });
        
        tagProcess.stderr.on('data', (data) => {
          const stderr = data.toString();
          
          // Append to buffer and split into lines
          const fullData = stderrBuffer + stderr;
          const lines = fullData.split('\n');

          // Last line may be incomplete, save to buffer
          stderrBuffer = lines.pop() || '';

          // Send each complete line to callback
          if (onOutput) {
            for (const line of lines) {
              if (line.trim()) { // Skip empty lines
                onOutput({ source: 'stderr', data: line });
              }
            }
          }
        });
        
        tagProcess.on('close', (code) => {
          // Process remaining lines in buffer
          if (stdoutBuffer && onOutput) {
            onOutput({ source: 'stdout', data: stdoutBuffer });
          }
          
          if (stderrBuffer && onOutput) {
            onOutput({ source: 'stderr', data: stderrBuffer });
          }
          
          if (code === 0) {
            resolve();
          } else {
            reject(new Error(`Failed to tag Docker image with exit code ${code}`));
          }
        });
        
        tagProcess.on('error', (error) => {
          reject(error);
        });
      });
      
      // Push the image to ECR using spawn for real-time output
      logger.info(`Pushing image to ECR: ${remoteImage}`);
      
      await new Promise<void>((resolve, reject) => {
        const pushCommand = 'docker';
        const pushArgs = ['push', remoteImage];
        
        const pushProcess = spawn(pushCommand, pushArgs);
        
        let stdoutBuffer = '';
        let stderrBuffer = '';
        
        pushProcess.stdout.on('data', (data) => {
          const stdout = data.toString();
          
          // Append to buffer and split into lines
          const fullData = stdoutBuffer + stdout;
          const lines = fullData.split('\n');

          // Last line may be incomplete, save to buffer
          stdoutBuffer = lines.pop() || '';

          // Send each complete line to callback
          if (onOutput) {
            for (const line of lines) {
              if (line.trim()) { // Skip empty lines
                onOutput({ source: 'stdout', data: line });
              }
            }
          }
        });
        
        pushProcess.stderr.on('data', (data) => {
          const stderr = data.toString();
          
          // Append to buffer and split into lines
          const fullData = stderrBuffer + stderr;
          const lines = fullData.split('\n');

          // Last line may be incomplete, save to buffer
          stderrBuffer = lines.pop() || '';

          // Send each complete line to callback
          if (onOutput) {
            for (const line of lines) {
              if (line.trim()) { // Skip empty lines
                // For Docker, success messages often go to stderr
                if (line.includes('Pushed')) {
                  onOutput({ source: 'stdout', data: line });
                } else {
                  onOutput({ source: 'stderr', data: line });
                }
              }
            }
          }
        });
        
        pushProcess.on('close', (code) => {
          // Process remaining lines in buffer
          if (stdoutBuffer && onOutput) {
            onOutput({ source: 'stdout', data: stdoutBuffer });
          }
          
          if (stderrBuffer && onOutput) {
            const stderrContent = stderrBuffer.trim();
            if (stderrContent) {
              if (stderrContent.includes('Pushed')) {
                onOutput({ source: 'stdout', data: stderrBuffer });
              } else {
                onOutput({ source: 'stderr', data: stderrBuffer });
              }
            }
          }
          
          if (code === 0) {
            resolve();
          } else {
            reject(new Error(`Failed to push Docker image with exit code ${code}`));
          }
        });
        
        pushProcess.on('error', (error) => {
          reject(error);
        });
      });
      
      logger.info(`Successfully pushed image to ECR: ${remoteImage}`);
      return remoteImage;
    } catch (error) {
      logger.error('Error pushing image to ECR:', error);
      const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
      throw new Error(`Failed to push image to ECR`);
    }
  }
}
