import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs';
import { logger } from '../utils/logger';
import { DeployPort } from '../types';

export interface CommandOutput {
  source: 'stdout' | 'stderr';
  data: string;
}

export class ImageBuilder {
  private stdoutLineBuffer: string = '';
  private stderrLineBuffer: string = '';

  async buildImage(
    projectDir: string,
    imageName: string,
    imageTag: string,
    dockerfilePath?: string,
    ports?: DeployPort[],
    onOutput?: (data: CommandOutput) => void,
    signal?: AbortSignal,
  ): Promise<string> {
    try {
      const dockerfile = dockerfilePath ? path.join(projectDir, dockerfilePath) : path.join(projectDir, 'Dockerfile');
      const fullImageName = `${imageName}`; // Removed imageTag as requested
      
      logger.info(`Building Docker image ${fullImageName} from ${projectDir}`);
      
      // Check if Dockerfile exists
      const dockerfileExists = fs.existsSync(dockerfile);
      
      if (dockerfileExists) {
        logger.info(`Using Dockerfile at ${dockerfile}`);
        return this.buildWithDockerfile(projectDir, fullImageName, dockerfile, onOutput, signal);
      } else {
        const containerPort = ports?.[0]?.containerPort || 3000;
        logger.info(`No Dockerfile found at ${dockerfile}, using Paketo buildpacks`);
        return this.buildWithPaketo(projectDir, fullImageName, containerPort, onOutput, signal);
      }
    } catch (error) {
      logger.error('Error building Docker image:', error);      
      throw new Error(`Failed to build Docker image`);
    }
  }

  private async buildWithDockerfile(
    projectDir: string,
    fullImageName: string,
    dockerfile: string,
    onOutput?: (data: CommandOutput) => void,
    signal?: AbortSignal
  ): Promise<string> {
    // docker build --platform linux/amd64 --progress=plain -t ABC .
    // Build the docker command and arguments for spawn
    const buildCommand = 'docker';
    const buildArgs = [
      'build',
      '--platform', 'linux/amd64',
      '--progress', 'plain',
      '-t', fullImageName,
      '-f', dockerfile,
      projectDir
    ];
    
    logger.info(`Executing command: ${buildCommand} ${buildArgs.join(' ')}`);
    
    // Use spawn for real-time output
    return this.executeCommand(buildCommand, buildArgs, 'build', fullImageName, onOutput, signal);
  }

  private async buildWithPaketo(
    projectDir: string,
    fullImageName: string,
    containerPort?: number,
    onOutput?: (data: CommandOutput) => void,
    signal?: AbortSignal
  ): Promise<string> {
    // Use pack CLI (Cloud Native Buildpacks) with Paketo builder
    const packCommand = 'pack';
    const packArgs = [
      'build',
      fullImageName,
      '--path', projectDir,
      '--builder', 'paketobuildpacks/builder:base',
      '--trust-builder',
      '--env', 'BP_INCLUDE_FILES=*',
      '--env', 'BP_NODE_VERSION=18.*',  // Default to Node 18
      '--env', `PORT=${containerPort || 3000}`,
      '--platform', 'linux/amd64'
    ];
    
    // Log the command we're about to execute
    logger.info(`Building with Paketo: ${packCommand} ${packArgs.join(' ')}`);

    if (onOutput) {
      onOutput({ 
        source: 'stdout', 
        data: 'No Dockerfile found. Using Paketo buildpacks to build image...' 
      });
    }
    
    return this.executeCommand(packCommand, packArgs, 'paketo build', fullImageName, onOutput, signal);
  }

  private executeCommand(
    command: string,
    args: string[],
    operation: string,
    imageName: string,
    onOutput?: (data: CommandOutput) => void,
    signal?: AbortSignal
  ): Promise<string> {
    this.stdoutLineBuffer = '';
    this.stderrLineBuffer = '';
    
    return new Promise((resolve, reject) => {
      // If the signal is already aborted, reject immediately
      if (signal?.aborted) {
        logger.info(`Operation ${operation} aborted before it started`);
        reject(new Error(`${operation} aborted`));
        return;
      }
      
      const process = spawn(command, args);
      
      // Set up abort handler
      if (signal) {
        const abortHandler = () => {
          logger.info(`Aborting ${operation} due to cancellation signal`);
          // Kill the process
          process.kill('SIGTERM');
          
          // After a timeout, force kill if still running
          setTimeout(() => {
            try {
              if (process.exitCode === null) {
                logger.info(`Process did not exit gracefully, forcing kill`);
                process.kill('SIGKILL');
              }
            } catch (e) {
              // Process may have already exited, ignore errors
            }
          }, 5000);
          
          reject(new Error(`${operation} aborted`));
        };
        
        signal.addEventListener('abort', abortHandler, { once: true });
        
        // Clean up event listener when process exits
        process.on('close', () => {
          signal.removeEventListener('abort', abortHandler);
        });
      }
      
      // Handle stdout data - line by line processing
      process.stdout.on('data', (data) => {
        const stdout = data.toString();
        
        const fullData = this.stdoutLineBuffer + stdout;
        const lines = fullData.split('\n');
        
        this.stdoutLineBuffer = lines.pop() || '';
        
        // Send each complete line to callback
        if (onOutput) {
          for (const line of lines) {
            if (line.trim()) { // Skip empty lines
              onOutput({ source: 'stdout', data: line });
            }
          }
        }
      });
      
      // Handle stderr data - line by line processing
      process.stderr.on('data', (data) => {
        const stderr = data.toString();
        
        const fullData = this.stderrLineBuffer + stderr;
        const lines = fullData.split('\n');
        
        this.stderrLineBuffer = lines.pop() || '';
        
        if (onOutput) {
          for (const line of lines) {
            if (line.trim()) {
              onOutput({ source: 'stderr', data: line });
            }
          }
        }
      });
      
      process.on('close', (code) => {
        if (this.stdoutLineBuffer && onOutput) {
          onOutput({ source: 'stdout', data: this.stdoutLineBuffer });
        }
        
        if (this.stderrLineBuffer && onOutput) {
          onOutput({ source: 'stderr', data: this.stderrLineBuffer });
        }

        this.stdoutLineBuffer = '';
        this.stderrLineBuffer = '';
        
        if (code === 0) {
          logger.info(`${operation} for ${imageName} completed successfully`);
          resolve(imageName);
        } else {
          const errorMessage = `${operation} failed with exit code ${code}`;
          logger.error(errorMessage);
          reject(new Error(`Failed to ${operation.toLowerCase()}`));
        }
      });
      
      process.on('error', (error) => {
        const errorMessage = error.message || 'Unknown error occurred';
        logger.error(`Error during ${operation}:`, error);
        reject(new Error(`Failed to ${operation.toLowerCase()}`));
      });
    });
  }
  
  async tagImage(
    imageName: string, 
    imageTag: string, 
    newImageName: string, 
    newImageTag: string,
    onOutput?: (data: CommandOutput) => void,
    signal?: AbortSignal
  ): Promise<string> {
    try {
      const sourceImage = `${imageName}`; 
      const targetImage = `${newImageName}:${newImageTag}`;
      
      logger.info(`Tagging Docker image ${sourceImage} as ${targetImage}`);
      
      // Build the docker command and arguments for spawn
      const tagCommand = 'docker';
      const tagArgs = ['tag', sourceImage, targetImage];
      
      // Use the common executeCommand method, which handles AbortSignal properly
      return this.executeCommand(tagCommand, tagArgs, 'tag', targetImage, onOutput, signal);
    } catch (error) {
      logger.error('Error tagging Docker image:', error);
      const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
      throw new Error(`Failed to tag Docker image`);
    }
  }

  async clean(imageName?: string): Promise<void> {
    if (imageName) {
      // Clean up specific built image
      logger.info(`Cleaning up Docker image: ${imageName}`);
      
      try {
        // Remove the specific image
        await new Promise<void>((resolve, reject) => {
          const removeCommand = 'docker';
          const removeArgs = ['rmi', '-f', imageName];
          
          const removeProcess = spawn(removeCommand, removeArgs);
          
          removeProcess.on('close', (code) => {
            if (code === 0) {
              logger.info(`Docker image ${imageName} removed successfully`);
              resolve();
            } else {
              logger.warn(`Docker image ${imageName} removal failed with code ${code} (image may not exist)`);
              resolve(); // Don't fail if image doesn't exist
            }
          });
          
          removeProcess.on('error', (error) => {
            const errorMessage = error.message || 'Unknown error occurred';
            logger.error(`Error removing Docker image ${imageName}: ${errorMessage}`);
            reject(new Error(`Failed to remove Docker image: ${errorMessage}`));
          });
        });
        
        logger.info(`Docker image cleanup completed for ${imageName}`);
        return;
      } catch (error) {
        logger.error(`Error cleaning Docker image ${imageName}:`, error);
        const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
        throw new Error(`Failed to clean Docker image: ${errorMessage}`);
      }
    } else {
      // Clean up only dangling images (not all images)
      logger.info('Cleaning up dangling Docker images');
      
      try {
        // Remove only dangling images (untagged intermediate images)
        await new Promise<void>((resolve, reject) => {
          const pruneCommand = 'docker';
          const pruneArgs = ['image', 'prune', '-f'];
          
          const pruneProcess = spawn(pruneCommand, pruneArgs);
          
          pruneProcess.on('close', (code) => {
            if (code === 0) {
              logger.info('Docker dangling images cleanup completed successfully');
              resolve();
            } else {
              logger.error(`Docker image prune failed with code ${code}`);
              reject(new Error(`Docker image prune failed with code ${code}`));
            }
          });
          
          pruneProcess.on('error', (error) => {
            const errorMessage = error.message || 'Unknown error occurred';
            logger.error(`Error executing Docker image prune: ${errorMessage}`);
            reject(new Error(`Failed to execute Docker image prune: ${errorMessage}`));
          });
        });
        
        logger.info('Docker cleanup completed');
        return;
      } catch (error) {
        logger.error('Error cleaning Docker images:', error);
        const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
        throw new Error(`Failed to clean Docker images: ${errorMessage}`);
      }
    }
  }
}
