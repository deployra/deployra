import fs from 'fs';
import path from 'path';
import { logger } from './logger';
import { config } from '../config';

/**
 * Ensures that the working directory for deployments exists
 */
export function ensureWorkDirExists(): void {
  try {
    if (!fs.existsSync(config.deployment.workDir)) {
      logger.info(`Creating deployment working directory: ${config.deployment.workDir}`);
      fs.mkdirSync(config.deployment.workDir, { recursive: true });
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
    logger.error(`Failed to create working directory: ${errorMessage}`);
    throw new Error(`Failed to create working directory: ${errorMessage}`);
  }
}

/**
 * Cleans up old deployment directories to prevent disk space issues
 * @param maxAgeDays Maximum age of deployment directories in days to keep
 */
export function cleanupOldDeployments(maxAgeDays = 7): void {
  try {
    const now = Date.now();
    const maxAgeMs = maxAgeDays * 24 * 60 * 60 * 1000;
    
    if (!fs.existsSync(config.deployment.workDir)) {
      return;
    }
    
    const entries = fs.readdirSync(config.deployment.workDir, { withFileTypes: true });
    
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      
      const dirPath = path.join(config.deployment.workDir, entry.name);
      const stats = fs.statSync(dirPath);
      
      // If directory is older than maxAgeDays, remove it
      if (now - stats.mtimeMs > maxAgeMs) {
        logger.info(`Removing old deployment directory: ${dirPath}`);
        fs.rmSync(dirPath, { recursive: true, force: true });
      }
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
    logger.warn(`Failed to clean up old deployments: ${errorMessage}`);
  }
}
