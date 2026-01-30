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

export interface ContainerRegistryConfig {
  imageUri: string;
  token?: string;
  username?: string;
  password?: string;
  type?: 'ecr' | 'ghcr' | 'docker';
}

export interface KubeDeploymentConfig {
  serviceType: 'web' | 'private' | 'mysql' | 'memory' | 'postgresql' | 'etcd';
  deploymentId?: string;
  serviceId: string;
  projectId: string;
  organizationId: string;
  containerRegistry: ContainerRegistryConfig;
  environmentVariables?: { key: string; value: string }[];
  scaling?: {
    replicas?: number;
    minReplicas?: number;
    maxReplicas?: number;
    targetCPUUtilizationPercentage?: number;
  };
  autoScalingEnabled?: boolean;
  resources?: {
    requests?: {
      cpu?: string;
      memory?: string;
    };
    limits?: {
      cpu?: string;
      memory?: string;
    };
  };
  readinessProbe?: {
    httpGet: {
      path: string;
      port: number;
    };
    initialDelaySeconds?: number;
    periodSeconds?: number;
  };
  livenessProbe?: {
    httpGet: {
      path: string;
      port: number;
    };
    initialDelaySeconds?: number;
    periodSeconds?: number;
  };
  ports?: {
    containerPort: number;
    servicePort: number;
  }[];
  domains?: string[];
  storage?: {
    size?: string;
    storageClass?: string;
  };
  credentials?: {
    username: string;
    password: string;
    database: string;
  };
  scaleToZeroEnabled: boolean;
}
