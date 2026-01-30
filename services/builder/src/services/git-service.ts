import simpleGit, { SimpleGit } from 'simple-git';
import path from 'path';
import fs from 'fs';
import { logger } from '../utils/logger';
import { config } from '../config';

export class GitService {
  private git: SimpleGit;
  
  constructor() {
    this.git = simpleGit();
  }
  
  async cloneRepository(repoUrl: string, branch: string, deploymentId: string): Promise<string> {
    try {
      const workDir = path.join(config.deployment.workDir, deploymentId);
      
      // Create directory if it doesn't exist
      if (!fs.existsSync(workDir)) {
        logger.info(`Creating directory for deployment: ${workDir}`);
        fs.mkdirSync(workDir, { recursive: true });
      } else {
        // Clean existing directory if it already exists
        logger.info(`Cleaning existing directory for deployment: ${workDir}`);
        // Remove all files except .git to make it faster if it's the same repo
        const entries = fs.readdirSync(workDir, { withFileTypes: true });
        for (const entry of entries) {
          if (entry.name !== '.git') {
            const entryPath = path.join(workDir, entry.name);
            fs.rmSync(entryPath, { recursive: true, force: true });
          }
        }
      }
      
      logger.info(`Cloning repository ${repoUrl} branch ${branch} into ${workDir}`);
      
      // Clone the repository with the specified branch and optimizations for minimal download
      await this.git.clone(repoUrl, workDir, [
        '--branch', branch, 
        '--single-branch',
        '--depth', '1',           // Shallow clone - only latest commit
        '--filter=blob:none',     // Skip downloading file contents initially
        '--no-tags'               // Don't download tags
      ]);
      
      logger.info(`Repository cloned successfully into ${workDir}`);
      return workDir;
    } catch (error) {
      logger.error('Error cloning repository:', error);
      const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
      throw new Error(`Failed to clone repository: ${errorMessage}`);
    }
  }
  
  async checkoutBranch(workDir: string, branch: string): Promise<void> {
    try {
      const localGit = simpleGit(workDir);
      logger.info(`Checking out branch ${branch} in ${workDir}`);
      await localGit.checkout(branch);
      logger.info(`Successfully checked out branch ${branch}`);
    } catch (error) {
      logger.error('Error checking out branch:', error);
      const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
      throw new Error(`Failed to checkout branch: ${errorMessage}`);
    }
  }
  
  async checkoutCommit(workDir: string, commitSha: string): Promise<void> {
    try {
      const localGit = simpleGit(workDir);
      logger.info(`Checking out commit ${commitSha} in ${workDir}`);
      await localGit.checkout(commitSha);
      logger.info(`Successfully checked out commit ${commitSha}`);
    } catch (error) {
      logger.error('Error checking out commit:', error);
      const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
      throw new Error(`Failed to checkout commit: ${errorMessage}`);
    }
  }
}
