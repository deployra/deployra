/**
 * Deployment status enum matching the Prisma schema
 */
export enum DeploymentStatus {
  PENDING = 'PENDING',
  BUILDING = 'BUILDING',
  BUILDED = 'BUILDED',
  DEPLOYING = 'DEPLOYING',
  DEPLOYED = 'DEPLOYED',
  FAILED = 'FAILED',
  CANCELLED = 'CANCELLED'
}

/**
 * Service status enum matching the Prisma schema
 */
export enum ServiceStatus {
  PENDING = 'PENDING',
  DEPLOYING = 'DEPLOYING',
  RUNNING = 'RUNNING',
  STOPPED = 'STOPPED',
  SUSPENDED = 'SUSPENDED',
  SLEEPING = 'SLEEPING',
  RESTARTING = 'RESTARTING',
  FAILED = 'FAILED'
}

/**
 * Deployment queue item structure
 */
export interface GithubAccount {
  username: string;
  accessToken: string;
}

export interface GitProvider {
  type: string;
  installationId: string;
  githubAccount: GithubAccount;
  url: string;
  username: string | null;
  password: string | null;
}

export interface DeployEnvironmentVariable {
  key: string;
  value: string;
}

export interface DeployPort {
  servicePort: number;
  containerPort: number;
}

// Interface for deployment request
export interface DeploymentQueueItem {
  deploymentId: string;
  serviceId: string;
  commitSha: string;
  branch: string;
  repositoryName: string;
  runtimeFilePath: string | null;
  gitProvider: GitProvider;
  environmentVariables?: DeployEnvironmentVariable[];
  ports?: DeployPort[];
}