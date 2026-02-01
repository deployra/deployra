import { GitProviderType } from "@prisma/client";
import Cookies from "js-cookie";
import { 
  User, 
  Organization, CreateOrganizationInput, 
  GitProvider, Repository, Branch, RepositoryDescription, 
  Service, CreateServiceInput, ServiceType, InstanceTypeGroup, 
  InstanceType, ServiceEvent, Deployment, DeploymentLog, PodInfo, ProfileUpdateData, PasswordUpdateData,
  GithubAccount, ApiKey, UpdateServiceScalingInput,
  Project,
  CreateCronJobInput, CronJob, UpdateCronJobInput,
  MetricsResponse,
  Template, Category, YamlValidationResult,
} from "./models";

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || "http://127.0.0.1:8080/api";

interface ApiResponse<T> {
  status: "success" | "error";
  data?: T;
  message?: string;
}

export class ApiError extends Error {
  data: unknown;

  constructor(message: string, data: unknown) {
    super(message);
    this.name = "ApiError";
    this.data = data;
  }
}

async function fetchApi<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
  const token = getToken();
  if (!token) {
    throw new Error("No authentication token found");
  }

  const res = await fetch(`${API_BASE_URL}${endpoint}`, {
    ...options,
    headers: {
      ...options.headers,
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
  });

  // Handle 401 Unauthorized - token expired or invalid
  if (res.status === 401) {
    removeToken();
    window.location.href = "/login";
    throw new Error("Authentication expired");
  }

  // Handle 403 Forbidden - user is banned
  if (res.status === 403) {
    removeToken();
    window.location.href = "/login";
    throw new Error("Your account has been suspended");
  }

  const data: ApiResponse<T> = await res.json();

  if (data.status !== "success") {
    throw new ApiError(data.message || "API request failed", data.data);
  }

  if (!data.data) {
    throw new Error("Invalid API response");
  }

  return data.data;
}

async function fetchPublicApi<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
  const res = await fetch(`${API_BASE_URL}${endpoint}`, {
    ...options,
    headers: {
      ...options.headers,
      "Content-Type": "application/json",
    },
  });

  const data: ApiResponse<T> = await res.json();
  
  if (data.status !== "success") {
    throw new ApiError(data.message || "API request failed", data.data);
  }

  if (!data.data) {
    throw new Error("Invalid API response");
  }

  return data.data;
}

export function resendVerificationEmail(): Promise<{ message: string }> {
  return fetchApi<{ message: string }>(`/auth/resend-verification`, {
    method: "POST",
  });
}

export async function getUser(): Promise<User> {
  return fetchApi<User>("/auth/user");
}

export async function getOrganizations(): Promise<Organization[]> {
  return fetchApi<Organization[]>("/organizations");
}

export async function getOrganization(id: string): Promise<Organization> {
  return fetchApi<Organization>(`/organizations/${id}`);
}

export async function createOrganization(input: CreateOrganizationInput): Promise<Organization> {
  return fetchApi<Organization>("/organizations", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

// Git Providers API functions
export async function getGitProviders(organizationId: string): Promise<GitProvider[]> {
  return fetchApi<GitProvider[]>(`/git-providers?organizationId=${organizationId}`);
}

export async function createGitProvider(data: { type: GitProviderType; organizationId: string; url: string; username: string; password: string }): Promise<GitProvider> {
  return fetchApi<GitProvider>("/git-providers", {
    method: "POST",
    body: JSON.stringify(data),
  });
}

export async function deleteGitProvider(providerId: string): Promise<{ message: string }> {
  return fetchApi<{ message: string }>(`/git-providers/${providerId}`, {
    method: "DELETE",
  });
}

// Repository and branch related functions
export function getRepositories(providerId: string): Promise<Repository[]> {
  return fetchApi<Repository[]>(`/git-providers/${providerId}/repositories`);
}

export function getBranches(providerId: string, repoFullName: string): Promise<Branch[]> {
  const encodedRepoName = encodeURIComponent(repoFullName);
  return fetchApi<Branch[]>(`/git-providers/${providerId}/repositories/${encodedRepoName}/branches`);
}

export function getRepositoryDescription(providerId: string, repoFullName: string, branch: string, dockerFilePath?: string): Promise<RepositoryDescription> {
  return fetchApi<RepositoryDescription>(
    `/git-providers/${providerId}/repositories/description`,
    {
      method: 'POST',
      body: JSON.stringify({
        repositoryName: repoFullName,
        branch: branch,
        dockerfilePath: dockerFilePath || undefined
      })
    }
  );
}

export function getServices(projectId: string): Promise<Service[]> {
  return fetchApi<Service[]>(`/services?projectId=${projectId}`);
}

export function getService(serviceId: string): Promise<Service> {
  return fetchApi<Service>(`/services/${serviceId}`);
}

export function createService(data: CreateServiceInput): Promise<Service> {
  return fetchApi<Service>("/services", {
    method: "POST",
    body: JSON.stringify(data),
  });
}

export function updateService(
  serviceId: string, 
  data: Partial<CreateServiceInput>
): Promise<Service> {
  return fetchApi<Service>(`/services/${serviceId}`, {
    method: "PATCH",
    body: JSON.stringify(data),
  });
}

export function deleteService(serviceId: string): Promise<{ message: string }> {
  return fetchApi<{ message: string }>(`/services/${serviceId}`, {
    method: "DELETE",
  });
}

// Service events API functions
export function getServiceEvents(serviceId: string): Promise<ServiceEvent[]> {
  return fetchApi<ServiceEvent[]>(`/services/${serviceId}/events`);
}

// Service deployment and restart API functions
export function deployService(serviceId: string, commitSha?: string): Promise<Deployment> {
  return fetchApi<Deployment>(`/services/${serviceId}/deploy`, {
    method: "POST",
    body: JSON.stringify({ commitSha }),
  });
}

export function cancelDeployment(deploymentId: string): Promise<{ message: string }> {
  return fetchApi<{ message: string }>(`/deployments/${deploymentId}/cancel`, {
    method: "POST"
  });
}

export function getServiceDeployments(
  serviceId: string, 
  filters?: { 
    status?: string; 
    date?: string; 
    search?: string;
    page?: number;
    limit?: number;
  }
): Promise<{ deployments: Deployment[]; pagination: { totalItems: number; totalPages: number; currentPage: number; itemsPerPage: number } }> {
  const searchParams = new URLSearchParams();
  
  if (filters) {
    if (filters.status) searchParams.append('status', filters.status);
    if (filters.date) searchParams.append('date', filters.date);
    if (filters.search) searchParams.append('search', filters.search);
    if (filters.page) searchParams.append('page', filters.page.toString());
    if (filters.limit) searchParams.append('limit', filters.limit.toString());
  }

  const queryString = searchParams.toString() ? `?${searchParams.toString()}` : '';
  return fetchApi<{ deployments: Deployment[]; pagination: { totalItems: number; totalPages: number; currentPage: number; itemsPerPage: number } }>(`/services/${serviceId}/deployments${queryString}`);
}

export function getDeployment(deploymentId: string): Promise<Deployment> {
  return fetchApi<Deployment>(`/deployments/${deploymentId}`);
}

export function getDeploymentLogs(deploymentId: string): Promise<{ logs: DeploymentLog[] }> {
  return fetchApi<{ logs: DeploymentLog[] }>(`/deployments/${deploymentId}/logs`);
}

export function restartService(serviceId: string): Promise<{ message: string }> {
  return fetchApi<{ message: string }>(`/services/${serviceId}/restart`, {
    method: "POST",
  });
}

// Service update API functions
export function updateServiceSettings(serviceId: string, data: {
  name?: string;
  customDomain?: string | null,
  healthCheckPath?: string,
  autoDeployEnabled?: boolean,
  instanceTypeId?: string,
  storageCapacity?: number,
  portSettings?: { servicePort: number; containerPort: number }[],
  containerCommand?: string | null
}): Promise<Service> {
  return fetchApi<Service>(`/services/${serviceId}`, {
    method: "PATCH",
    body: JSON.stringify(data),
  });
}

export function updateServiceEnvironment(serviceId: string, environmentVariables: { key: string; value: string }[]): Promise<Service> {
  return fetchApi<Service>(`/services/${serviceId}`, {
    method: "PATCH",
    body: JSON.stringify({ environmentVariables }),
  });
}

export function updateServiceScaling(serviceId: string, data: UpdateServiceScalingInput): Promise<Service> {
  return fetchApi<Service>(`/services/${serviceId}`, {
    method: "PATCH",
    body: JSON.stringify(data),
  });
}

// GitHub accounts API functions
export async function getGithubAccounts(organizationId: string): Promise<GithubAccount[]> {
  return fetchApi<GithubAccount[]>(`/github/accounts?organizationId=${organizationId}`);
}

export function getApiKeys(): Promise<ApiKey[]> {
  return fetchApi<ApiKey[]>('/api-keys');
}

export function createApiKey(data: { name: string }): Promise<ApiKey> {
  return fetchApi<ApiKey>('/api-keys', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export function deleteApiKey(id: string): Promise<{ message: string }> {
  return fetchApi<{ message: string }>(`/api-keys/${id}`, {
    method: 'DELETE',
  });
}

// Service Types API functions
export function getServiceTypes(): Promise<ServiceType[]> {
  return fetchApi<ServiceType[]>('/service-types');
}

// Instance Types API functions
export async function getInstanceTypeGroups(serviceTypeId: string): Promise<InstanceTypeGroup[]> {
  return fetchApi<InstanceTypeGroup[]>(`/instance-type-groups?serviceTypeId=${serviceTypeId}`);
}

export async function getInstanceTypes(instanceTypeGroupId: string): Promise<InstanceType[]> {
  return fetchApi<InstanceType[]>(`/instance-types?instanceTypeGroupId=${instanceTypeGroupId}`);
}

// Project related functions
export async function getProjects(organizationId: string): Promise<Project[]> {
  return fetchApi<Project[]>(
    `/projects?organizationId=${organizationId}`
  );
}

export async function createProject(data: { name: string; description?: string; organizationId: string }): Promise<Project> {
  return fetchApi<Project>("/projects", {
    method: "POST",
    body: JSON.stringify(data),
  });
}

export async function getProject(projectId: string): Promise<Project> {
  return fetchApi<Project>(`/projects/${projectId}`);
}

export async function updateProject(projectId: string, data: { name?: string; description?: string | null; webhookUrl?: string | null }): Promise<Project> {
  return fetchApi<Project>(`/projects/${projectId}`, {
    method: "POST",
    body: JSON.stringify(data),
  });
}

export async function deleteProject(projectId: string): Promise<void> {
  return fetchApi<void>(`/projects/${projectId}`, {
    method: "DELETE",
  });
}

export function setToken(token: string) {
  const expires = new Date();
  expires.setDate(expires.getDate() + 30); // 30 day expiration
  
  Cookies.set("token", token, {
    expires,
    path: "/",
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production" || window.location.protocol === "https:",
  });
}

export function getToken(): string | null {
  return Cookies.get("token") || null;
}

export function removeToken() {
  Cookies.remove("token", { path: "/" });
}

export function getCronJobs(
  serviceId: string
): Promise<CronJob[]> {
  return fetchApi<CronJob[]>(`/services/${serviceId}/cronjobs`);
}

export function getCronJob(
  serviceId: string,
  cronJobId: string
): Promise<CronJob> {
  return fetchApi<CronJob>(`/services/${serviceId}/cronjobs/${cronJobId}`);
}

export function createCronJob(
  serviceId: string,
  data: CreateCronJobInput
): Promise<CronJob> {
  return fetchApi<CronJob>(`/services/${serviceId}/cronjobs`, {
    method: "POST",
    body: JSON.stringify(data),
  });
}

export function updateCronJob(
  serviceId: string,
  cronJobId: string,
  data: UpdateCronJobInput
): Promise<CronJob> {
  return fetchApi<CronJob>(`/services/${serviceId}/cronjobs/${cronJobId}`, {
    method: "PATCH",
    body: JSON.stringify(data),
  });
}

export function deleteCronJob(
  serviceId: string,
  cronJobId: string
): Promise<{ message: string }> {
  return fetchApi<{ message: string }>(`/services/${serviceId}/cronjobs/${cronJobId}`, {
    method: "DELETE",
  });
}

export function getServiceMetrics(
  serviceId: string,
  timeRange: 'hour' | 'day' | 'week' | 'month' = 'day',
  startDate?: string,
  endDate?: string
): Promise<MetricsResponse> {
  const params = new URLSearchParams();
  params.append('timeRange', timeRange);
  if (startDate) params.append('startDate', startDate);
  if (endDate) params.append('endDate', endDate);
  
  return fetchApi<MetricsResponse>(`/services/${serviceId}/metrics?${params.toString()}`);
}

// Get all environment variables for a service (keys only, masked values)
export function getServiceEnvironmentVariables(serviceId: string): Promise<Array<{ key: string; value: string }>> {
  return fetchApi<Array<{ key: string; value: string }>>(`/services/${serviceId}/environment-variables`);
}

// Get a single environment variable value
export function getEnvironmentVariableValue(serviceId: string, key: string): Promise<{ value: string }> {
  return fetchApi<{ value: string }>(`/services/${serviceId}/environment-variables/${encodeURIComponent(key)}`);
}

// Update environment variables (add or modify)
export function updateEnvironmentVariables(serviceId: string, variables: Array<{ key: string; value: string }>): Promise<{ message: string; count: number }> {
  return fetchApi<{ message: string; count: number }>(`/services/${serviceId}/environment-variables/update`, {
    method: "PATCH",
    body: JSON.stringify({ variables }),
  });
}

// Delete environment variables by keys
export function deleteEnvironmentVariables(serviceId: string, keys: string[]): Promise<{ message: string; count: number }> {
  return fetchApi<{ message: string; count: number }>(`/services/${serviceId}/environment-variables/delete`, {
    method: "POST",
    body: JSON.stringify({ keys }),
  });
}

// Kubernetes Pod Operations
export async function getServicePods(serviceId: string): Promise<PodInfo[]> {
  return fetchApi<PodInfo[]>(`/services/${serviceId}/pods`);
}

export async function updateProfile(data: ProfileUpdateData): Promise<User> {
  return fetchApi<User>('/account/profile', {
    method: 'PATCH',
    body: JSON.stringify(data),
  });
}

export async function updatePassword(data: PasswordUpdateData): Promise<{ message: string }> {
  return fetchApi<{ message: string }>('/account/password', {
    method: 'PATCH',
    body: JSON.stringify(data),
  });
}

export async function validateDockerImage(imageUrl: string, dockerUsername?: string, dockerPassword?: string): Promise<boolean> {
  const result = await fetchApi<{ isValid: boolean }>('/docker-images/validate', {
    method: 'POST',
    body: JSON.stringify({ 
      imageUrl,
      dockerUsername,
      dockerPassword 
    }),
  });
  
  return result.isValid;
}

export async function validateYamlTemplate(yamlTemplate: string): Promise<YamlValidationResult> {
  const result = await fetchPublicApi<YamlValidationResult>('/templates/validate', {
    method: 'POST',
    body: JSON.stringify({ yamlTemplate }),
  });
  
  return result;
}

export async function createServicesFromTemplate(projectId: string, yamlTemplate: string): Promise<Service[]> {
  const result = await fetchApi<Service[]>('/services/template', {
    method: 'POST',
    body: JSON.stringify({ projectId, yamlTemplate }),
  });
  
  return result;
}

// Template API functions
export async function getTemplates(params?: {
  search?: string;
  category?: string;
  featured?: boolean;
  limit?: number;
  offset?: number;
}): Promise<{ templates: Template[]; total: number }> {
  const searchParams = new URLSearchParams();
  
  if (params?.search) searchParams.set('search', params.search);
  if (params?.category) searchParams.set('category', params.category);
  if (params?.featured) searchParams.set('featured', 'true');
  if (params?.limit) searchParams.set('limit', params.limit.toString());
  if (params?.offset) searchParams.set('offset', params.offset.toString());
  
  return fetchPublicApi<{ templates: Template[]; total: number }>(`/templates?${searchParams.toString()}`);
}

export async function getTemplate(slug: string): Promise<Template> {
  return fetchPublicApi<Template>(`/templates/${slug}`);
}

export async function getTemplateCategories(): Promise<Category[]> {
  return fetchPublicApi<Category[]>('/templates/categories');
}


