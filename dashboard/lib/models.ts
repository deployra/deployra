
export interface CreateOrganizationInput {
  name: string;
  description?: string;
}

// GitHub related types
export interface GithubAccount {
  id: string;
  username: string;
  email: string | null;
  avatarUrl: string | null;
  createdAt: Date;
}

export interface GitProvider {
  id: string;
  githubAccount: {
    username: string;
    avatarUrl: string | null;
  } | null;
  installationId: string | null;
  githubAccountId: string | null;
  type: string;
  url: string;
  username: string;
  repositorySelection: string;
  createdAt: Date;
}

export interface Project {
  id: string;
  name: string;
  description: string | null;
  organizationId: string;
  webhookUrl: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface Repository {
  id: string;
  name: string;
  fullName: string;
  private: boolean;
  description: string | null;
  defaultBranch: string;
  url: string;
  createdAt: string;
  updatedAt: string;
}

export interface Branch {
  name: string;
  protected: boolean;
  commitSha: string;
  url: string;
}

export interface User {
  id: string;
  email: string;
  firstName?: string | null;
  lastName?: string | null;
  emailVerified?: Date | null;
  createdAt: Date;
}

export interface Organization {
  id: string;
  userId: string;
  name: string;
  description?: string | null;
  createdAt: Date;
  updatedAt: Date;
}

// Repository metadata functions
export interface RepositoryDescription {
  languages: Record<string, number>;
  hasDockerfile: boolean;
  hasProcfile: boolean;
  defaultBranch: string;
}


// Service related functions
export interface ServicePort {
  id: number;
  serviceId: string;
  servicePort: number;
  containerPort: number;
  createdAt: string;
  updatedAt: string;
}

export interface Service {
  id: string;
  name: string;
  serviceTypeId: string;
  status: "PENDING" | "DEPLOYING" | "RUNNING" | "STOPPED" | "SUSPENDED" | "SLEEPING" | "FAILED" | "RESTARTING";
  projectId: string;
  gitProviderId: string | null;
  repositoryName: string | null;
  branch: string | null;
  runtime: "IMAGE" | "DOCKER";
  containerRegistryImageUri?: string;
  subdomain?: string;
  customDomain?: string;
  createdAt: string;
  updatedAt: string;
  deployedAt?: string;
  minReplicas: number;
  maxReplicas: number;
  replicas: number;
  autoScalingEnabled: boolean;
  autoDeployEnabled?: boolean;
  targetCPUUtilizationPercentage?: number;
  healthCheckPath?: string;
  lastDeployment?: Deployment | null;
  credentials?: ServiceCredential | null;
  instanceType: InstanceType;
  storageCapacity?: number; // Storage capacity in GB (primarily for MySQL and Memory instances)
  storageUsage?: number;
  runtimeFilePath?: string; // Path to the Dockerfile within the repository
  ports?: ServicePort[];
  scaleToZeroEnabled?: boolean; // Scale to zero feature for free instances
}

export interface ServiceCredential {
  id: string;
  serviceId: string;
  host: string;
  port: number;
  username: string;
  password: string;
  database: string;
  createdAt: string;
  updatedAt: string;
}

export interface ServiceTypeTag {
  id: string;     // Used as the primary identifier 
  label: string;  // Display name: 'Application', 'Database', etc.
  index: number;  // For ordering
  createdAt: string;
  updatedAt: string;
}

export interface ServiceType {
  id: string;      // 'web', 'private', etc.
  title: string;
  description: string;
  tagId: string;
  tag: ServiceTypeTag; // Related tag object
  index: number;
  isVisible: boolean;
  createdAt: string;
  updatedAt: string;
  instanceTypeGroups?: InstanceTypeGroup[];
}

export interface InstanceTypeGroup {
  id: string;
  name: string;
  description?: string;
  serviceTypeId: string;
  index: number;
  isVisible: boolean;
  createdAt: string;
  updatedAt: string;
  instanceTypes: InstanceType[];
}

export interface InstanceType {
  id: string;
  name: string;
  description?: string;
  instanceTypeGroupId: string;
  cpuCount: number;
  memoryMB: number;
  index: number;
  isVisible: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ServiceEvent {
  id: string;
  serviceId: string;
  type: "DEPLOY_STARTED" | "DEPLOY_COMPLETED" | "DEPLOY_FAILED" | "DEPLOY_CANCELLED" | "SERVICE_RESTART_STARTED" | "SERVICE_RESTART_COMPLETED" | "CONFIG_UPDATED" | "SERVICE_SCALED" | "SERVICE_SCALING";
  message?: string;
  deploymentId?: string;
  deployment?: Deployment | null;
  createdAt: string;
  payload?: Record<string, unknown>;
}

export interface Deployment {
  id: string;
  deploymentNumber: number;
  serviceId: string;
  status: "PENDING" | "BUILDING" | "DEPLOYING" | "DEPLOYED" | "FAILED" | "CANCELLED";
  commitSha?: string;
  branch?: string;
  triggeredBy: string;
  triggerType: "manual" | "webhook" | "scheduled" | "automatic";
  buildLogs?: string;
  deploymentLogs?: string;
  startedAt: string;
  completedAt?: string;
  createdAt: string;
  updatedAt: string;
  triggerUser?: {
    id: string;
    firstName: string | null;
    lastName: string | null;
  };
}

export interface DeploymentLog {
  id: string;
  type: string;
  text: string;
  createdAt: string;
}

export interface CreateServiceInput {
  name: string;
  serviceTypeId: string;
  projectId: string;
  gitProviderId?: string;
  repositoryName?: string;
  branch?: string;
  runtimeFilePath?: string;
  dockerImageUrl?: string;
  environmentVariables?: { key: string; value: string }[];
  portSettings?: { servicePort: number; containerPort: number }[];
  storageCapacity?: number;
  instanceTypeId: string;
}

export interface UpdateServiceScalingInput {
  minReplicas?: number;
  maxReplicas?: number;
  replicas?: number;
  targetCPUUtilizationPercentage?: number;
  autoScalingEnabled?: boolean;
}

export interface ApiKey {
  id: string;
  name: string;
  key: string;
  createdAt: string;
  lastUsedAt: string;
}


// Service metrics API functions
export interface ServiceMetricsData {
  id: number;
  serviceId: string;
  deploymentId?: string;
  totalCpuUsage: number;
  avgCpuUsage: number;
  totalMemoryUsage: number;
  avgMemoryUsage: number;
  cpuUtilizationPercentage?: number;
  memoryUtilizationPercentage?: number;
  timestamp: string;
  createdAt: string;
  podMetrics: PodMetricsData[];
}

// CronJob related interfaces and functions
export interface CronJob {
  id: string;
  name: string;
  schedule: string;
  path: string;
  headers: Record<string, string> | null;
  enabled: boolean;
  serviceId: string;
  createdAt: string;
  updatedAt: string;
  lastRunAt: string | null;
  nextRunAt: string | null;
}

export interface CreateCronJobInput {
  name: string;
  schedule: string;
  path: string;
  headers?: Record<string, string> | null;
  enabled?: boolean;
}

export interface UpdateCronJobInput {
  name?: string;
  schedule?: string;
  path?: string;
  headers?: Record<string, string> | null;
  enabled?: boolean;
}

export interface PodMetricsData {
  id: number;
  podId: string;
  serviceId: string;
  serviceMetricsId: number;
  cpuUsage: number;
  cpuLimit?: number;
  memoryUsage: number;
  memoryLimit?: number;
  timestamp: string;
  createdAt: string;
}

export interface MetricsResponse {
  serviceMetrics: ServiceMetricsData[];
}

// Pod information interfaces
export interface PodInfo {
  name: string;
  status: string;
  ready: string;
  restarts: number;
  age: string;
}

// User profile functions
export interface ProfileUpdateData {
  firstName: string;
  lastName: string;
  email: string;
}

export interface PasswordUpdateData {
  currentPassword: string;
  newPassword: string;
  confirmPassword: string;
}


export interface Template {
    id: string;
    slug: string;
    title: string;
    description: string;
    content?: string | null;
    category: string;
    tags: string | null;
    author: string;
    featured: boolean;
    usageCount: number;
    yamlTemplate: string;
    createdAt: string;
    updatedAt: string;
  }
  
  export interface Category {
    name: string;
    count: number;
  }

// YAML Template validation
export interface YamlValidationResult {
  valid: boolean;
  message?: string;
  serviceCount?: number;
  databaseCount?: number;
  memoryCount?: number;
  data?: Array<{ path: (string | number)[]; message: string }>;
}