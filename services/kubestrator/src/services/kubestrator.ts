import { CoreV1Api, KubeConfig, AppsV1Api, CustomObjectsApi, NetworkingV1Api } from '@kubernetes/client-node';
import { ContainerRegistryConfig, KubeDeploymentConfig } from '../types';
import { logger } from '../utils/logger';
import { config } from '../config';
import { ECRService } from './ecr-service';
import * as dashboardApi from '../utils/dashboard-api';
import { DeploymentStatus, ServiceStatus } from '../types';
import { Redis } from 'ioredis';
import { createPrivateServiceDeploymentCompletePatch, createPrivateServiceDeploymentManifest, createPrivateServiceHPAManifest, createPrivateServicePersistentVolumeClaimManifest, createPrivateServicePersistentVolumeManifest, createPrivateServiceServiceManifest } from './private-service';
import { createWebServiceDeploymentCompletePatch, createWebServiceDeploymentManifest, createWebServiceHPAManifest, createWebServicePersistentVolumeClaimManifest, createWebServicePersistentVolumeManifest, createWebServiceServiceManifest } from './web-service';
import { createMysqlConfdConfigMapManifest, createMySqlServiceDeploymentCompletePatch, createMySqlServiceDeploymentManifest, createMySqlServicePersistentVolumeClaimManifest, createMySqlServicePersistentVolumeManifest, createMySqlServiceServiceManifest } from './mysql-service';
import { createMemoryConfigConfigMapManifest, createMemoryServiceDeploymentCompletePatch, createMemoryServiceDeploymentManifest, createMemoryServicePersistentVolumeClaimManifest, createMemoryServicePersistentVolumeManifest, createMemoryServiceServiceManifest } from './memory-service';
import { createPostgresqlConfigMapManifest, createPostgresqlServiceDeploymentCompletePatch, createPostgresqlServiceDeploymentManifest, createPostgresqlServicePersistentVolumeClaimManifest, createPostgresqlServicePersistentVolumeManifest, createPostgresqlServiceServiceManifest } from './postgresql-service';

// Define interfaces for our event types
interface DeployServiceEvent extends KubeDeploymentConfig {
  type: 'deploy-service';
}

interface DeleteOrganizationEvent {
  organizationId: string;
  type: 'delete-organization';
}

interface DeleteProjectEvent {
  projectId: string;
  organizationId: string;
  type: 'delete-project';
}

interface DeleteServiceEvent {
  serviceId: string;
  projectId: string;
  organizationId: string;
  type: 'delete-service';
}

interface ControlServiceEvent {
  serviceId: string;
  projectId: string;
  organizationId: string;
  action: "scale-up" | "scale-down";
  type: 'control-service';
}

// Union type for all event types
type KubestratorEvent = DeployServiceEvent | DeleteOrganizationEvent | DeleteProjectEvent | DeleteServiceEvent | ControlServiceEvent;

class KubeStratorService {
  private redis: Redis;
  private statusRedis: Redis;
  private k8sApi: CoreV1Api;
  private appsApi: AppsV1Api;
  private customObjectsApi: CustomObjectsApi;
  private k8sNetworkingApi: NetworkingV1Api;
  private ecrService: ECRService;

  constructor() {
    const kc = new KubeConfig();

    // Redis for job queue
    this.redis = new Redis({
      host: config.redis.host,
      port: config.redis.port,
      username: config.redis.username,
      password: config.redis.password
    });

    // Redis for deployment status (shared with web-proxy)
    this.statusRedis = new Redis({
      host: config.statusRedis.host,
      port: config.statusRedis.port,
      password: config.statusRedis.password,
      db: config.statusRedis.db
    });

    kc.loadFromDefault();
    this.k8sApi = kc.makeApiClient(CoreV1Api);
    this.appsApi = kc.makeApiClient(AppsV1Api);
    this.customObjectsApi = kc.makeApiClient(CustomObjectsApi);
    this.k8sNetworkingApi = kc.makeApiClient(NetworkingV1Api);
    this.ecrService = new ECRService();
  }

  async start() {
    logger.info('Starting KubeStrator service');

    // Check Kubernetes connection
    try {
      await this.k8sApi.listNamespace();
      logger.info('Successfully connected to Kubernetes cluster');
    } catch (error) {
      logger.error('Failed to connect to Kubernetes cluster:', error);
      throw error;
    }

    // Start CrashLoopBackOff cleanup timer if enabled
    if (config.crashLoopCleanup.enabled) {
      logger.info(`CrashLoopBackOff cleanup enabled - checking every ${config.crashLoopCleanup.checkIntervalMinutes} minutes`);
      this.startCrashLoopCleanupTimer();
    } else {
      logger.info('CrashLoopBackOff cleanup is disabled');
    }

    // Start the main message processor
    this.processMessages();
  }

  private async processMessages() {
    // Continuously process messages from Redis
    while (true) {
      try {
        const event = await this.redis.brpop(config.redis.queueName, 1);
        if (event) {
          const parsedEvent = JSON.parse(event[1]) as KubestratorEvent;

          // Handle different event types
          if ('type' in parsedEvent) {
            switch (parsedEvent.type) {
              case 'deploy-service':
                await this.deploy(parsedEvent);
                break;
              case 'delete-organization':
                await this.deleteOrganization(parsedEvent);
                break;
              case 'delete-project':
                await this.deleteProject(parsedEvent);
                break;
              case 'delete-service':
                await this.deleteService(parsedEvent);
                break;
              case 'control-service':
                await this.controlService(parsedEvent);
                break;
              default:
                logger.warn(`Unknown event type: ${(parsedEvent as any).type}`);
            }
          }
        }
      } catch (error) {
        // Await 1 second before retrying
        await new Promise(resolve => setTimeout(resolve, 1000));
        logger.error('Error processing event:', error);
      }
    }
  }

  private async deleteRawService(productId: string, serviceId: string) {
    const namespace = productId || 'default';
    const deployName = `${serviceId}-deployment`;
    const serviceName = `${serviceId}-service`;
    const hpaName = `${serviceId}-hpa`;
    const pvName = `${serviceId}-pv`;
    const pvcName = `${serviceId}-pvc`;
    const registrySecretName = `${serviceId}-container-registry-secret`;
    const envSecretName = `${serviceId}-env-secret`;
    const mysqlConfigMapName = `${serviceId}-mysql-config`;
    const memoryConfigMapName = `${serviceId}-memory-config`;

    try {
      // Delete deployment
      await this.appsApi.deleteNamespacedDeployment(deployName, namespace);
    } catch (error) {
      logger.error(`Failed to delete deployment ${deployName}:`, error);
    }

    try {
      // Delete service
      await this.k8sApi.deleteNamespacedService(serviceName, namespace);
    } catch (error) {
      logger.error(`Failed to delete service ${serviceName}:`, error);
    }

    try {
      // Delete hpa
      await this.customObjectsApi.deleteNamespacedCustomObject('autoscaling', 'v2', namespace, 'horizontalpodautoscalers', hpaName);
    } catch (error) {
      logger.error(`Failed to delete hpa ${hpaName}:`, error);
    }

    try {
      // Delete pvc
      await this.k8sApi.deleteNamespacedPersistentVolumeClaim(
        pvcName,
        namespace,
        undefined,
        undefined,
        undefined,
        undefined,
        "Background" // Delete dependent objects in the background
      );
    } catch (error) {
      logger.error(`Failed to delete pvc ${pvcName}:`, error);
    }

    try {
      // Delete pv
      await this.k8sApi.deletePersistentVolume(
        pvName,
        undefined,
        undefined,
        undefined,
        undefined,
        "Background" // Delete dependent objects in the background
      );
    } catch (error) {
      logger.error(`Failed to delete pv ${pvName}:`, error);
    }

    try {
      // Delete registry secret
      await this.k8sApi.deleteNamespacedSecret(registrySecretName, namespace);
    } catch (error) {
      logger.error(`Failed to delete registry secret ${registrySecretName}:`, error);
    }

    try {
      // Delete env secret
      await this.k8sApi.deleteNamespacedSecret(envSecretName, namespace);
    } catch (error) {
      logger.error(`Failed to delete env secret ${envSecretName}:`, error);
    }

    try {
      // Delete config map
      await this.k8sApi.deleteNamespacedConfigMap(mysqlConfigMapName, namespace);
    } catch (error) {
      logger.error(`Failed to delete config map ${mysqlConfigMapName}:`, error);
    }

    try {
      // Delete config map
      await this.k8sApi.deleteNamespacedConfigMap(memoryConfigMapName, namespace);
    } catch (error) {
      logger.error(`Failed to delete config map ${memoryConfigMapName}:`, error);
    }

    logger.info(`Successfully deleted service: ${serviceId}`);
  }

  private async deleteService(event: DeleteServiceEvent) {
    const { serviceId } = event;
    logger.info(`Deleting service: ${serviceId}`);

    const namespace = event.projectId || 'default';
    const deployName = `${serviceId}-deployment`;
    const serviceName = `${serviceId}-service`;
    const hpaName = `${serviceId}-hpa`;
    const pvName = `${serviceId}-pv`;
    const pvcName = `${serviceId}-pvc`;
    const registrySecretName = `${serviceId}-container-registry-secret`;
    const envSecretName = `${serviceId}-env-secret`;
    const mysqlConfigMapName = `${serviceId}-mysql-config`;
    const memoryConfigMapName = `${serviceId}-memory-config`;
    const postgresqlConfigMapName = `${serviceId}-postgresql-config`;

    try {
      // Delete deployment
      await this.appsApi.deleteNamespacedDeployment(deployName, namespace);
    } catch (error) {
      logger.error(`Failed to delete deployment ${deployName}:`, error);
    }

    try {
      // Delete service
      await this.k8sApi.deleteNamespacedService(serviceName, namespace);
    } catch (error) {
      logger.error(`Failed to delete service ${serviceName}:`, error);
    }

    try {
      // Delete hpa
      await this.customObjectsApi.deleteNamespacedCustomObject('autoscaling', 'v2', namespace, 'horizontalpodautoscalers', hpaName);
    } catch (error) {
      logger.error(`Failed to delete hpa ${hpaName}:`, error);
    }

    try {
      // Delete pvc
      await this.k8sApi.deleteNamespacedPersistentVolumeClaim(
        pvcName,
        namespace,
        undefined,
        undefined,
        undefined,
        undefined,
        "Background" // Delete dependent objects in the background
      );
    } catch (error) {
      logger.error(`Failed to delete pvc ${pvcName}:`, error);
    }

    try {
      // Delete pv
      await this.k8sApi.deletePersistentVolume(
        pvName,
        undefined,
        undefined,
        undefined,
        undefined,
        "Background" // Delete dependent objects in the background
      );
    } catch (error) {
      logger.error(`Failed to delete pv ${pvName}:`, error);
    }

    try {
      // Delete registry secret
      await this.k8sApi.deleteNamespacedSecret(registrySecretName, namespace);
    } catch (error) {
      logger.error(`Failed to delete registry secret ${registrySecretName}:`, error);
    }

    try {
      // Delete env secret
      await this.k8sApi.deleteNamespacedSecret(envSecretName, namespace);
    } catch (error) {
      logger.error(`Failed to delete env secret ${envSecretName}:`, error);
    }

    try {
      // Delete config map
      await this.k8sApi.deleteNamespacedConfigMap(mysqlConfigMapName, namespace);
    } catch (error) {
      logger.error(`Failed to delete config map ${mysqlConfigMapName}:`, error);
    }

    try {
      // Delete config map
      await this.k8sApi.deleteNamespacedConfigMap(memoryConfigMapName, namespace);
    } catch (error) {
      logger.error(`Failed to delete config map ${memoryConfigMapName}:`, error);
    }

    try {
      // Delete config map
      await this.k8sApi.deleteNamespacedConfigMap(postgresqlConfigMapName, namespace);
    } catch (error) {
      logger.error(`Failed to delete config map ${postgresqlConfigMapName}:`, error);
    }

    logger.info(`Successfully deleted service: ${serviceId}`);
  }

  private async controlService(event: ControlServiceEvent) {
    const { serviceId, projectId, action } = event;
    logger.info(`Controlling service: ${serviceId} with action: ${action}`);

    const namespace = projectId || 'default';
    const deployName = `${serviceId}-deployment`;
    const serviceName = `${serviceId}-service`;
    const hpaName = `${serviceId}-hpa`;

    try {
      // Get deployment to check service type from labels
      let serviceType: string | undefined;
      try {
        const deployment = await this.appsApi.readNamespacedDeployment(deployName, namespace);
        serviceType = deployment.body.metadata?.labels?.type;
      } catch (error) {
        logger.warn(`Could not read deployment to get service type: ${error}`);
      }

      // Determine replica count based on action
      const replicas = action === 'scale-up' ? 1 : 0;

      // Create patch to update replicas
      const replicaPatch = {
        spec: {
          replicas: replicas
        }
      };

      // Apply the patch to scale the deployment
      await this.appsApi.patchNamespacedDeployment(
        deployName,
        namespace,
        replicaPatch,
        undefined, // pretty
        undefined, // dryRun
        undefined, // fieldManager
        undefined, // fieldValidation
        {
          headers: {
            'Content-Type': 'application/merge-patch+json'
          }
        }
      );

      logger.info(`Successfully ${action === 'scale-up' ? 'scaled up' : 'scaled down'} service: ${serviceId} to ${replicas} replicas`);

      // Update deployment status in Redis (only for web services)
      const isActive = action === 'scale-up';
      await this.setDeploymentStatus(namespace, deployName, isActive, serviceType);
    } catch (error) {
      logger.error(`Failed to control service ${serviceId}:`, error);
      throw error;
    }
  }

  private async deleteOrganization(event: DeleteOrganizationEvent) {
    const { organizationId } = event;
    logger.info(`Deleting all resources for organization: ${organizationId}`);

    try {
      // Get all namespaces
      const namespacesResponse = await this.k8sApi.listNamespace();
      const namespaces = namespacesResponse.body.items;

      // Filter namespaces belonging to the organization
      // We'll use the namespaces that have the organizationId in their labels
      for (const namespace of namespaces) {
        const name = namespace.metadata?.name;
        const labels = namespace.metadata?.labels || {};

        // Check if namespace belongs to this organization
        const belongsToOrg = labels['organization'] === organizationId;

        if (belongsToOrg && name) {
          logger.info(`Deleting namespace "${name}" belonging to organization ${organizationId}`);

          try {
            // Deleting a namespace automatically deletes all resources in that namespace
            await this.k8sApi.deleteNamespace(name);
            logger.info(`Successfully requested deletion of namespace: ${name}`);
          } catch (err) {
            logger.error(`Failed to delete namespace ${name}:`, err);
          }
        }
      }

      // Get all HPA resources for the organization
      try {
        const hpaListResponse = await this.customObjectsApi.listNamespacedCustomObject(
          'autoscaling',
          'v2',
          '',
          'horizontalpodautoscalers'
        );
        // Use type assertion to avoid TypeScript errors
        const responseBody = hpaListResponse.body as { items: any[] };
        const hpas = responseBody.items || [];

        for (const hpa of hpas) {
          const labels = hpa.metadata?.labels || {};
          const belongsToOrg = labels['organization'] === organizationId;

          if (belongsToOrg && hpa.metadata?.name && hpa.metadata?.namespace) {
            logger.info(`Deleting HPA "${hpa.metadata.name}" in namespace "${hpa.metadata.namespace}"`);
            await this.customObjectsApi.deleteNamespacedCustomObject(
              'autoscaling',
              'v2',
              hpa.metadata.namespace,
              'horizontalpodautoscalers',
              hpa.metadata.name
            );
          }
        }
      } catch (error) {
        logger.warn(`Error deleting HPAs: ${error}`);
        // Continue with other resource cleanup
      }

      logger.info(`Completed organization deletion process for: ${organizationId}`);
    } catch (error) {
      logger.error(`Error deleting organization ${organizationId}:`, error);
      throw error;
    }
  }

  private async deleteRawProject(projectId: string) {
    try {
      // In Kubernetes, a project is represented as a namespace
      // Following the user's convention, namespace = projectId
      const namespace = projectId;

      // If we couldn't find the namespace by name, try to find deployments by projectId label
      const deployments = await this.findDeploymentsByProject(projectId);

      if (deployments.length > 0) {
        logger.info(`Found ${deployments.length} deployments for project ${projectId}`);

        // Delete each deployment
        for (const deployment of deployments) {
          const serviceId = deployment.metadata?.labels?.app ||
                          deployment.metadata?.labels?.service || '';

          if (!serviceId) {
            logger.warn(`Couldn't determine serviceId for deployment ${deployment.metadata?.name}`);
            continue;
          }

          // Use the exact naming patterns as specified
          const deployName = `${serviceId}-deployment`;
          const serviceName = `${serviceId}-service`;
          const hpaName = `${serviceId}-hpa`;
          const pvName = `${serviceId}-pv`;
          const pvcName = `${serviceId}-pvc`;
          const registrySecretName = `${serviceId}-container-registry-secret`;
          const envSecretName = `${serviceId}-env-secret`;
          const mysqlConfigMapName = `${serviceId}-mysql-config`;
          const memoryConfigMapName = `${serviceId}-memory-config`;

          // Delete deployment
          try {
            await this.appsApi.deleteNamespacedDeployment(deployName, namespace);
            logger.info(`Deleted deployment ${deployName} in namespace ${namespace}`);
          } catch (err) {
            logger.warn(`Could not delete deployment ${deployName}:`, err);
          }

          // Delete service
          try {
            await this.k8sApi.deleteNamespacedService(serviceName, namespace);
            logger.info(`Deleted service ${serviceName} in namespace ${namespace}`);
          } catch (err) {
            logger.warn(`Could not delete service ${serviceName}:`, err);
          }

          try {
            // Delete hpa
            await this.customObjectsApi.deleteNamespacedCustomObject('autoscaling', 'v2', namespace, 'horizontalpodautoscalers', hpaName);
          } catch (error) {
            logger.error(`Failed to delete hpa ${hpaName}:`, error);
          }

          try {
            // Delete pvc
            await this.k8sApi.deleteNamespacedPersistentVolumeClaim(
              pvcName,
              namespace,
              undefined,
              undefined,
              undefined,
              undefined,
              "Background" // Delete dependent objects in the background
            );
          } catch (error) {
            logger.error(`Failed to delete pvc ${pvcName}:`, error);
          }

          try {
            // Delete pv
            await this.k8sApi.deletePersistentVolume(
              pvName,
              undefined,
              undefined,
              undefined,
              undefined,
              "Background" // Delete dependent objects in the background
            );
          } catch (error) {
            logger.error(`Failed to delete pv ${pvName}:`, error);
          }

          try {
            // Delete registry secret
            await this.k8sApi.deleteNamespacedSecret(registrySecretName, namespace);
          } catch (error) {
            logger.error(`Failed to delete registry secret ${registrySecretName}:`, error);
          }

          try {
            // Delete env secret
            await this.k8sApi.deleteNamespacedSecret(envSecretName, namespace);
          } catch (error) {
            logger.error(`Failed to delete env secret ${envSecretName}:`, error);
          }

          try {
            // Delete config map
            await this.k8sApi.deleteNamespacedConfigMap(mysqlConfigMapName, namespace);
          } catch (error) {
            logger.error(`Failed to delete config map ${mysqlConfigMapName}:`, error);
          }

          try {
            // Delete config map
            await this.k8sApi.deleteNamespacedConfigMap(memoryConfigMapName, namespace);
          } catch (error) {
            logger.error(`Failed to delete config map ${memoryConfigMapName}:`, error);
          }
        }
      } else {
        logger.warn(`No deployments found for project ${projectId}`);
      }

      try {
        logger.info(`Deleting network policy ${namespace}`);
        try {
          // Delete network policy
          await this.customObjectsApi.deleteNamespacedCustomObject(
            'networking.k8s.io',
            'v1',
            namespace,
            'networkpolicies',
            `${namespace}-network-policy`
          );
        } catch (error) {
          logger.error(`Failed to delete network policy ${namespace}-network-policy:`, error);
        }

        logger.info(`Deleting namespace ${namespace}`);
        await this.k8sApi.deleteNamespace(namespace);

        logger.info(`Successfully requested deletion of namespace: ${namespace}`);
        return;
      } catch (err) {
        // Namespace doesn't exist, fall back to finding individual deployments
        logger.info(`Namespace ${namespace} not found, will look for individual deployments`);
      }

      logger.info(`Completed project deletion process for: ${projectId}`);
    } catch (error) {
      logger.error(`Error deleting project ${projectId}:`, error);
      throw error;
    }
  }

  private async deleteProject(event: DeleteProjectEvent) {
    const { projectId, organizationId } = event;
    logger.info(`Deleting project ${projectId} for organization ${organizationId}`);

    try {
      // In Kubernetes, a project is represented as a namespace
      // Following the user's convention, namespace = projectId
      const namespace = projectId;

      // If we couldn't find the namespace by name, try to find deployments by projectId label
      const deployments = await this.findDeploymentsByProject(projectId);

      if (deployments.length > 0) {
        logger.info(`Found ${deployments.length} deployments for project ${projectId}`);

        // Delete each deployment
        for (const deployment of deployments) {
          const serviceId = deployment.metadata?.labels?.app ||
                          deployment.metadata?.labels?.service || '';

          if (!serviceId) {
            logger.warn(`Couldn't determine serviceId for deployment ${deployment.metadata?.name}`);
            continue;
          }

          // Use the exact naming patterns as specified
          const deployName = `${serviceId}-deployment`;
          const serviceName = `${serviceId}-service`;
          const hpaName = `${serviceId}-hpa`;
          const pvName = `${serviceId}-pv`;
          const pvcName = `${serviceId}-pvc`;
          const registrySecretName = `${serviceId}-container-registry-secret`;
          const envSecretName = `${serviceId}-env-secret`;
          const mysqlConfigMapName = `${serviceId}-mysql-config`;
          const memoryConfigMapName = `${serviceId}-memory-config`;

          // Delete deployment
          try {
            await this.appsApi.deleteNamespacedDeployment(deployName, namespace);
            logger.info(`Deleted deployment ${deployName} in namespace ${namespace}`);
          } catch (err) {
            logger.warn(`Could not delete deployment ${deployName}:`, err);
          }

          // Delete service
          try {
            await this.k8sApi.deleteNamespacedService(serviceName, namespace);
            logger.info(`Deleted service ${serviceName} in namespace ${namespace}`);
          } catch (err) {
            logger.warn(`Could not delete service ${serviceName}:`, err);
          }

          try {
            // Delete hpa
            await this.customObjectsApi.deleteNamespacedCustomObject('autoscaling', 'v2', namespace, 'horizontalpodautoscalers', hpaName);
          } catch (error) {
            logger.error(`Failed to delete hpa ${hpaName}:`, error);
          }

          try {
            // Delete pvc
            await this.k8sApi.deleteNamespacedPersistentVolumeClaim(
              pvcName,
              namespace,
              undefined,
              undefined,
              undefined,
              undefined,
              "Background" // Delete dependent objects in the background
            );
          } catch (error) {
            logger.error(`Failed to delete pvc ${pvcName}:`, error);
          }

          try {
            // Delete pv
            await this.k8sApi.deletePersistentVolume(
              pvName,
              undefined,
              undefined,
              undefined,
              undefined,
              "Background" // Delete dependent objects in the background
            );
          } catch (error) {
            logger.error(`Failed to delete pv ${pvName}:`, error);
          }

          try {
            // Delete registry secret
            await this.k8sApi.deleteNamespacedSecret(registrySecretName, namespace);
          } catch (error) {
            logger.error(`Failed to delete registry secret ${registrySecretName}:`, error);
          }

          try {
            // Delete env secret
            await this.k8sApi.deleteNamespacedSecret(envSecretName, namespace);
          } catch (error) {
            logger.error(`Failed to delete env secret ${envSecretName}:`, error);
          }

          try {
            // Delete config map
            await this.k8sApi.deleteNamespacedConfigMap(mysqlConfigMapName, namespace);
          } catch (error) {
            logger.error(`Failed to delete config map ${mysqlConfigMapName}:`, error);
          }

          try {
            // Delete config map
            await this.k8sApi.deleteNamespacedConfigMap(memoryConfigMapName, namespace);
          } catch (error) {
            logger.error(`Failed to delete config map ${memoryConfigMapName}:`, error);
          }
        }
      } else {
        logger.warn(`No deployments found for project ${projectId}`);
      }

      try {
        logger.info(`Deleting network policy ${namespace}`);
        try {
          // Delete network policy
          await this.customObjectsApi.deleteNamespacedCustomObject(
            'networking.k8s.io',
            'v1',
            namespace,
            'networkpolicies',
            `${namespace}-network-policy`
          );
        } catch (error) {
          logger.error(`Failed to delete network policy ${namespace}-network-policy:`, error);
        }

        logger.info(`Deleting namespace ${namespace}`);
        await this.k8sApi.deleteNamespace(namespace);

        logger.info(`Successfully requested deletion of namespace: ${namespace}`);
        return;
      } catch (err) {
        // Namespace doesn't exist, fall back to finding individual deployments
        logger.info(`Namespace ${namespace} not found, will look for individual deployments`);
      }

      logger.info(`Completed project deletion process for: ${projectId}`);
    } catch (error) {
      logger.error(`Error deleting project ${projectId}:`, error);
      throw error;
    }
  }

  private async findDeploymentsByProject(projectId: string) {
    try {
      const deploymentsList = await this.appsApi.listDeploymentForAllNamespaces();
      return deploymentsList.body.items.filter(deployment => {
        const labels = deployment.metadata?.labels || {};
        return labels['project'] === projectId || labels['projectId'] === projectId;
      });
    } catch (error) {
      logger.error(`Error finding deployments for project ${projectId}:`, error);
      return [];
    }
  }

  private async waitForDeploymentReady(deploymentName: string, namespace: string, timeoutMs: number = 30000, serviceType?: string): Promise<boolean> {
    const timeoutSeconds = Math.ceil(timeoutMs / 1000);
    logger.info(`Waiting for deployment ${deploymentName} to be ready (timeout: ${timeoutSeconds}s)...`);

    // Check if deployment is scaled down to 0 and scale it up if needed
    try {
      const initialDeployment = await this.appsApi.readNamespacedDeployment(
        deploymentName,
        namespace
      );

      const currentReplicas = initialDeployment.body.spec?.replicas;

      if (currentReplicas === 0 || currentReplicas === undefined) {
        logger.info(`Deployment ${deploymentName} is scaled down to ${currentReplicas}, scaling up to 1 replica...`);

        const scaleUpPatch = {
          spec: {
            replicas: 1
          }
        };

        await this.appsApi.patchNamespacedDeployment(
          deploymentName,
          namespace,
          scaleUpPatch,
          undefined,
          undefined,
          undefined,
          undefined,
          {
            headers: {
              'Content-Type': 'application/merge-patch+json'
            }
          }
        );

        logger.info(`Scaled up deployment ${deploymentName} to 1 replica`);

        // Update deployment status in Redis (set to active)
        await this.setDeploymentStatus(namespace, deploymentName, true, serviceType);
      }
    } catch (error) {
      logger.warn(`Error checking/scaling deployment ${deploymentName}: ${error}`);
      // Continue with rollout status
    }

    // Poll deployment status using Kubernetes client
    const pollIntervalMs = 2000;
    const startTime = Date.now();

    while (Date.now() - startTime < timeoutMs) {
      try {
        const deployment = await this.appsApi.readNamespacedDeployment(deploymentName, namespace);
        const status = deployment.body.status;
        const spec = deployment.body.spec;

        const desiredReplicas = spec?.replicas || 1;
        const readyReplicas = status?.readyReplicas || 0;
        const updatedReplicas = status?.updatedReplicas || 0;
        const availableReplicas = status?.availableReplicas || 0;

        logger.debug(`Deployment ${deploymentName} status: desired=${desiredReplicas}, ready=${readyReplicas}, updated=${updatedReplicas}, available=${availableReplicas}`);

        // Check if deployment is ready
        if (
          readyReplicas >= desiredReplicas &&
          updatedReplicas >= desiredReplicas &&
          availableReplicas >= desiredReplicas
        ) {
          logger.info(`Deployment ${deploymentName} is ready! (${readyReplicas}/${desiredReplicas} replicas)`);
          return true;
        }

        // Check for failed conditions
        const conditions = status?.conditions || [];
        const failedCondition = conditions.find(
          c => c.type === 'Progressing' && c.status === 'False' && c.reason === 'ProgressDeadlineExceeded'
        );

        if (failedCondition) {
          logger.error(`Deployment ${deploymentName} failed: ${failedCondition.message}`);
          return false;
        }

        // Wait before next poll
        await new Promise(resolve => setTimeout(resolve, pollIntervalMs));
      } catch (error: any) {
        logger.warn(`Error polling deployment status: ${error.message}`);
        await new Promise(resolve => setTimeout(resolve, pollIntervalMs));
      }
    }

    logger.error(`Deployment ${deploymentName} rollout timed out after ${timeoutSeconds}s`);
    return false;
  }

  // SetDeploymentStatus sets the status of a deployment in Redis (matching web-proxy behavior)
  // Only updates Redis for web services (scale-to-zero is only applicable to web services)
  private async setDeploymentStatus(namespace: string, deploymentName: string, isActive: boolean, serviceType?: string): Promise<void> {
    // Only set deployment status for web services
    if (serviceType && serviceType !== 'web') {
      return;
    }

    try {
      const key = `deployment:status:${namespace}:${deploymentName}`;
      const status = isActive ? '1' : '0';

      // Set with 24 hour TTL (matching web-proxy behavior)
      await this.statusRedis.set(key, status, 'EX', 24 * 60 * 60);

      logger.info(`Updated Redis deployment status for ${namespace}/${deploymentName}: ${isActive ? 'active' : 'inactive'}`);
    } catch (error) {
      logger.error(`Error setting deployment status in Redis: ${error}`);
    }
  }

  // Start periodic CrashLoopBackOff cleanup timer
  private startCrashLoopCleanupTimer(): void {
    const intervalMs = config.crashLoopCleanup.checkIntervalMinutes * 60 * 1000;

    setInterval(async () => {
      try {
        await this.checkCrashLoopBackOffPods();
      } catch (error) {
        logger.error('Error in CrashLoopBackOff cleanup timer:', error);
      }
    }, intervalMs);

    // Run once immediately on startup
    this.checkCrashLoopBackOffPods().catch(error => {
      logger.error('Error in initial CrashLoopBackOff check:', error);
    });
  }

  // Check for problematic pods and scale down deployments
  private async checkCrashLoopBackOffPods(): Promise<void> {
    logger.info('Checking for problematic pods (CrashLoopBackOff, ImagePullBackOff, InvalidImageName)...');

    // Reasons that should trigger immediate scale down (no restart count needed)
    const immediateScaleDownReasons = ['ImagePullBackOff', 'InvalidImageName', 'ErrImagePull'];

    try {
      // Get all pods across all namespaces
      const podsResponse = await this.k8sApi.listPodForAllNamespaces();
      const pods = podsResponse.body.items;

      const deploymentsToScaleDown: Array<{ namespace: string; deployment: string; restartCount: number; reason: string }> = [];

      // Find pods in problematic states
      for (const pod of pods) {
        const namespace = pod.metadata?.namespace;
        const podName = pod.metadata?.name;
        const containerStatuses = pod.status?.containerStatuses || [];

        if (!namespace || !podName) continue;

        // Check container statuses for problematic states
        for (const containerStatus of containerStatuses) {
          const waitingReason = containerStatus.state?.waiting?.reason;
          const restartCount = containerStatus.restartCount || 0;

          let shouldScaleDown = false;
          let reason = waitingReason || 'Unknown';

          // Check for CrashLoopBackOff with high restart count
          if (waitingReason === 'CrashLoopBackOff' && restartCount > config.crashLoopCleanup.minRestartCount) {
            shouldScaleDown = true;
          }

          // Check for image-related errors (immediate scale down)
          if (waitingReason && immediateScaleDownReasons.includes(waitingReason)) {
            shouldScaleDown = true;
          }

          if (shouldScaleDown) {
            // Extract deployment name from pod name
            const deploymentName = podName.replace(/-[a-z0-9]+-[a-z0-9]+$/, '');

            // Check if already in list
            const exists = deploymentsToScaleDown.some(
              d => d.namespace === namespace && d.deployment === deploymentName
            );

            if (!exists) {
              deploymentsToScaleDown.push({
                namespace,
                deployment: deploymentName,
                restartCount,
                reason
              });
            }
          }
        }
      }

      if (deploymentsToScaleDown.length === 0) {
        logger.info('No problematic pods found');
        return;
      }

      logger.info(`Found ${deploymentsToScaleDown.length} problematic deployments to scale down`);

      // Scale down each deployment
      for (const item of deploymentsToScaleDown) {
        try {
          logger.info(`Scaling down ${item.namespace}/${item.deployment} (reason: ${item.reason}, restarts: ${item.restartCount})`);

          // Get deployment to check service type
          let serviceType: string | undefined;
          try {
            const deployment = await this.appsApi.readNamespacedDeployment(item.deployment, item.namespace);
            serviceType = deployment.body.metadata?.labels?.type;
          } catch (error) {
            logger.warn(`Could not read deployment to get service type: ${error}`);
          }

          // Scale down to 0
          await this.appsApi.patchNamespacedDeployment(
            item.deployment,
            item.namespace,
            {
              spec: {
                replicas: 0
              }
            },
            undefined,
            undefined,
            undefined,
            undefined,
            {
              headers: {
                'Content-Type': 'application/merge-patch+json'
              }
            }
          );

          logger.info(`Successfully scaled down ${item.namespace}/${item.deployment}`);

          // Update Redis status (only for web services)
          await this.setDeploymentStatus(item.namespace, item.deployment, false, serviceType);

          // Set crashloop flag to prevent auto scale-up
          try {
            const crashloopKey = `deployment:crashloop:${item.namespace}:${item.deployment}`;
            await this.statusRedis.set(crashloopKey, '1', 'EX', 24 * 60 * 60); // 24 hour TTL
            logger.info(`Set crashloop flag for ${item.namespace}/${item.deployment}`);
          } catch (error) {
            logger.warn(`Could not set crashloop flag: ${error}`);
          }

        } catch (error) {
          logger.error(`Failed to scale down ${item.namespace}/${item.deployment}: ${error}`);
        }
      }

      logger.info('CrashLoopBackOff cleanup completed');

    } catch (error) {
      logger.error('Error checking CrashLoopBackOff pods:', error);
    }
  }

  async createNamespace(name: string, labels: Record<string, string>): Promise<void> {
    // Create if not exists
    try {
      await this.k8sApi.readNamespace(name);
    } catch (error) {
      logger.info(`Namespace ${name} doesn't exist, creating it`);
      const namespaceManifest = {
        apiVersion: 'v1',
        kind: 'Namespace',
        metadata: {
          name: name,
          labels: labels
        },
      };
      await this.k8sApi.createNamespace(namespaceManifest);
      // await this.createNetworkPolicy(name, labels);
    }
  }

  async createNetworkPolicy(namespace: string, labels: Record<string, string>): Promise<void> {
    const networkPolicyManifest = {
      apiVersion: 'networking.k8s.io/v1',
      kind: 'NetworkPolicy',
      metadata: {
        name: `${namespace}-network-policy`,
        namespace: namespace,
        labels: labels
      },
      spec: {
        podSelector: {},
        policyTypes: ['Ingress'],
        from: [
          {
            podSelector: {},
            namespaceSelector: {
              matchLabels: {
                name: "system-apps"
              }
            }
          },
          {
            podSelector: {},
          }
        ]
      }
    };

    try {
      await this.customObjectsApi.createNamespacedCustomObject('networking.k8s.io', 'v1', namespace, 'networkpolicies', networkPolicyManifest);
    } catch (error) {
      logger.error(`Failed to create network policy ${namespace}:`, error);
    }
  }

  async createSecret(name: string, namespace: string, type: string, data: Record<string, string>): Promise<void> {
    // Replace or create secret
    const secretManifest = {
      apiVersion: 'v1',
      kind: 'Secret',
      metadata: {
        name: name,
        namespace: namespace,
      },
      type: type,
      data: data,
    };

    try {
      await this.k8sApi.replaceNamespacedSecret(name, namespace, secretManifest);
    } catch (error) {
      logger.info(`Secret ${name} doesn't exist, creating it`);
      await this.k8sApi.createNamespacedSecret(namespace, secretManifest);
    }
  }

  async createContainerRegistrySecret(namespace: string, serviceId: string, containerRegistry: ContainerRegistryConfig): Promise<string | undefined> {
    // This must happen before deployment since the deployment will reference this secret
    const secretName = `${serviceId}-container-registry-secret`;

    // Handle different container registry types
    if (containerRegistry.type === 'ecr') {
      // For ECR, get the token from AWS
      try {
        logger.info(`Getting ECR authorization token for service ${serviceId}`);
        const { token } = await this.ecrService.getAuthorizationToken();

        // Create secret with ECR token
        logger.info(`Creating/updating ECR container registry secret for service ${serviceId}`);

        // Extract just the registry URL from the image URI
        // Example: ABC.dkr.ecr.us-east-1.amazonaws.com/repository:tag
        // We need: ABC.dkr.ecr.us-east-1.amazonaws.com
        const imageUri = containerRegistry.imageUri;
        let registryUrl = '';

        // Better extraction of ECR registry URL
        if (imageUri.includes('.dkr.ecr.') && imageUri.includes('.amazonaws.com')) {
          // For ECR URLs, extract the host part
          const urlParts = imageUri.split('/');
          registryUrl = urlParts[0]; // Get the registry part before the first slash
        } else if (imageUri.includes('/')) {
          // For other URLs like ghcr.io/user/repo:tag
          registryUrl = imageUri.substring(0, imageUri.indexOf('/'));
        } else {
          registryUrl = imageUri;
        }

        logger.info(`Using ECR registry URL: ${registryUrl}`);

        await this.createSecret(secretName, namespace, 'kubernetes.io/dockerconfigjson', {
          '.dockerconfigjson': Buffer.from(JSON.stringify({
            auths: {
              [registryUrl]: {
                username: 'AWS',
                password: token,
                auth: Buffer.from(`AWS:${token}`).toString('base64'),
                email: 'not-used@example.com'
              }
            }
          })).toString('base64')
        });

        return secretName;
      } catch (error) {
        logger.error(`Error getting ECR authorization token: ${error}`);
        throw new Error(`Failed to get ECR authorization token: ${error}`);
      }
    } else if (containerRegistry.type === 'docker') {
      // For other registry types (ghcr, docker), use the provided token/password
      logger.info(`Creating/updating container registry secret for service ${serviceId}`);

      // Extract just the registry URL from the image URI
      // For Docker Hub: detcode/client:latest -> docker.io
      // For other registries: ghcr.io/username/repository:tag -> ghcr.io
      const imageUri = containerRegistry.imageUri;
      
      let registryUrl: string;
      if (imageUri.includes('/')) {
        const firstPart = imageUri.substring(0, imageUri.indexOf('/'));
        // Check if first part contains a dot (indicating it's a registry domain)
        if (firstPart.includes('.')) {
          registryUrl = firstPart;
        } else {
          // No registry domain, this is a Docker Hub image
          registryUrl = 'docker.io';
        }
      } else {
        // Single name image (like nginx:latest), defaults to Docker Hub
        registryUrl = 'docker.io';
      }

      logger.info(`Using registry URL: ${registryUrl} for image: ${imageUri}`);
      const username = containerRegistry.username || '';
      const password = containerRegistry.token || containerRegistry.password || '';

      await this.createSecret(secretName, namespace, 'kubernetes.io/dockerconfigjson', {
        '.dockerconfigjson': Buffer.from(JSON.stringify({
            auths: {
              [registryUrl]: {
                username: username,
                password: password,
                auth: Buffer.from(`${username}:${password}`).toString('base64'),
              },
            }
          })).toString('base64')
      });

      return secretName;
    }

    logger.info(`No container registry configuration provided for service ${serviceId}`);
    // throw new Error(`No container registry configuration provided for service ${serviceId}`);
    return undefined;
  }

  async createEnvironmentVariablesSecret(namespace: string, serviceId: string, environmentVariables: { key: string; value: string }[]): Promise<string | undefined> {
    if (!environmentVariables || environmentVariables.length === 0) {
      return undefined;
    }

    const secretName = `${serviceId}-env-secret`;

    // Convert all environment variables to base64 encoded strings
    const secretData: Record<string, string> = {};

    for (const { key, value } of environmentVariables) {
      // Convert value to string and then to base64
      const base64Value = Buffer.from(value).toString('base64');
      secretData[key] = base64Value;
    }

    // Create or update the secret
    await this.createSecret(secretName, namespace, 'Opaque', secretData);

    logger.info(`Created/updated environment variables secret for service ${serviceId}`);

    return secretName;
  }

  async createConfigMap(namespace: string, serviceId: string, config: KubeDeploymentConfig): Promise<void> {
    if (config.serviceType === 'mysql') {
      const confdConfigMap = createMysqlConfdConfigMapManifest(config);
      try {
        await this.k8sApi.replaceNamespacedConfigMap(
          confdConfigMap.metadata.name,
          namespace,
          confdConfigMap
        );
      } catch (error) {
        try {
          await this.k8sApi.createNamespacedConfigMap(namespace, confdConfigMap);
        } catch (createError) {
          logger.error(`Error creating confd config map for service ${serviceId}:`, createError);
          throw createError;
        }
      }
    } else if (config.serviceType === 'memory') {
      const memoryConfigMap = createMemoryConfigConfigMapManifest(config);
      try {
        await this.k8sApi.replaceNamespacedConfigMap(
          memoryConfigMap.metadata.name,
          namespace,
          memoryConfigMap
        );
      } catch (error) {
        try {
          await this.k8sApi.createNamespacedConfigMap(namespace, memoryConfigMap);
        } catch (createError) {
          logger.error(`Error creating memory config map for service ${serviceId}:`, createError);
          throw createError;
        }
      }
    } else if (config.serviceType === 'postgresql') {
      const postgresqlConfigMap = createPostgresqlConfigMapManifest(config);
      try {
        await this.k8sApi.replaceNamespacedConfigMap(
          postgresqlConfigMap.metadata.name,
          namespace,
          postgresqlConfigMap
        );
      } catch (error) {
        try {
          await this.k8sApi.createNamespacedConfigMap(namespace, postgresqlConfigMap);
        } catch (createError) {
          logger.error(`Error creating postgresql config map for service ${serviceId}:`, createError);
          throw createError;
        }
      }
    }
  }

  async createDeployment(namespace: string, config: KubeDeploymentConfig): Promise<string> {
    const deploymentName = `${config.serviceId}-deployment`;

    let registrySecretName: string | undefined;
    if (config.serviceType === 'private' || config.serviceType === 'web') {
      registrySecretName = await this.createContainerRegistrySecret(namespace, config.serviceId, config.containerRegistry);
    }

    // Create environment variables secret if there are environment variables
    let envSecretName: string | undefined;
    if (config.serviceType === 'mysql') {
      if (!config.environmentVariables) {
        config.environmentVariables = [];
      }

      config.environmentVariables.push({
        key: 'MYSQL_ROOT_PASSWORD',
        value: config.credentials?.password || 'mysql'
      });
      config.environmentVariables.push({
        key: 'MYSQL_DATABASE',
        value: config.credentials?.database || 'mysql'
      });
      config.environmentVariables.push({
        key: 'MYSQL_USER',
        value: config.credentials?.username || 'mysql'
      });
      config.environmentVariables.push({
        key: 'MYSQL_PASSWORD',
        value: config.credentials?.password || 'mysql'
      });
      config.environmentVariables.push({
        key: 'MYSQL_ROOT_HOST',
        value: '%'
      });
    } else if (config.serviceType === 'memory') {
      if (!config.environmentVariables) {
        config.environmentVariables = [];
      }

      config.environmentVariables.push({
        key: 'VALKEY_USER',
        value: config.credentials?.username || 'default'
      });
      config.environmentVariables.push({
        key: 'VALKEY_PASSWORD',
        value: config.credentials?.password || 'valkey'
      });
    } else if (config.serviceType === 'postgresql') {
      if (!config.environmentVariables) {
        config.environmentVariables = [];
      }

      config.environmentVariables.push({
        key: 'POSTGRES_DB',
        value: config.credentials?.database || 'postgres'
      });
      config.environmentVariables.push({
        key: 'POSTGRES_USER',
        value: config.credentials?.username || 'postgres'
      });
      config.environmentVariables.push({
        key: 'POSTGRES_PASSWORD',
        value: config.credentials?.password || 'postgres'
      });
    }

    if (config.environmentVariables && config.environmentVariables.length > 0) {
      envSecretName = await this.createEnvironmentVariablesSecret(namespace, config.serviceId, config.environmentVariables);
    }

    await this.createConfigMap(namespace, config.serviceId, config);

    let deploymentManifest: any;
    if (config.serviceType === 'private') {
      deploymentManifest = createPrivateServiceDeploymentManifest(deploymentName, config, registrySecretName, envSecretName);
    } else if (config.serviceType === 'web') {
      deploymentManifest = createWebServiceDeploymentManifest(deploymentName, config, registrySecretName, envSecretName);
    } else if (config.serviceType === 'mysql') {
      deploymentManifest = createMySqlServiceDeploymentManifest(deploymentName, config, envSecretName);
    } else if (config.serviceType === 'memory') {
      deploymentManifest = createMemoryServiceDeploymentManifest(deploymentName, config, envSecretName);
    } else if (config.serviceType === 'postgresql') {
      deploymentManifest = createPostgresqlServiceDeploymentManifest(deploymentName, config, envSecretName);
    } else {
      throw new Error(`Unsupported service type: ${config.serviceType}`);
    }

    // Check deployment exists or not
    let deploymentExists = false;
    try {
      await this.appsApi.readNamespacedDeployment(deploymentName, namespace);
      deploymentExists = true;
    } catch (error) {
      deploymentExists = false;
    }

    if (!deploymentExists) {
      // Deployment doesn't exist, create it from scratch
      logger.info(`Creating new deployment for service ${config.serviceId}`);
      await this.appsApi.createNamespacedDeployment(namespace, deploymentManifest);
    } else {
      // Deployment exists, determine what changed and update accordingly
      // Image changed - Update everything at once with a complete patch
      // This will trigger a zero-downtime rolling update of all pods
      logger.info(`Image changed for service ${config.serviceId}, updating with zero-downtime rolling update`);

      // Build a comprehensive patch that includes all configuration
      let completePatch: any;

      if (config.serviceType === 'private') {
        completePatch = createPrivateServiceDeploymentCompletePatch(config, registrySecretName, envSecretName);
      } else if (config.serviceType === 'web') {
        completePatch = createWebServiceDeploymentCompletePatch(config, registrySecretName, envSecretName);
      } else if (config.serviceType === 'mysql') {
        completePatch = createMySqlServiceDeploymentCompletePatch(config, envSecretName);
      } else if (config.serviceType === 'memory') {
        completePatch = createMemoryServiceDeploymentCompletePatch(config, envSecretName);
      } else if (config.serviceType === 'postgresql') {
        completePatch = createPostgresqlServiceDeploymentCompletePatch(config, envSecretName);
      } else {
        throw new Error(`Unsupported service type: ${config.serviceType}`);
      }

      logger.info(`Applying complete configuration update with new image for service ${config.serviceId}`);
      await this.appsApi.patchNamespacedDeployment(
        deploymentName,
        namespace,
        completePatch,
        undefined,
        undefined,
        undefined,
        undefined,
        {
          headers: {
            'Content-Type': 'application/strategic-merge-patch+json',
          },
        }
      );

      // Force a rollout if needed by checking deployment status
      try {
        const updatedDeployment = await this.appsApi.readNamespacedDeployment(
          deploymentName,
          namespace
        );

        // Check if deployment is stuck
        const conditions = updatedDeployment.body.status?.conditions || [];
        const isStuck = conditions.some(condition =>
          condition.type === 'Progressing' &&
          condition.status === 'False' &&
          condition.reason === 'ProgressDeadlineExceeded'
        );

        if (isStuck) {
          logger.info(`Deployment appears stuck, forcing rollout for service ${config.serviceId}`);

          // Force rollout by patching an annotation
          const rolloutPatch = {
            spec: {
              template: {
                metadata: {
                  annotations: {
                    'kubectl.kubernetes.io/restartedAt': new Date().toISOString()
                  }
                }
              }
            }
          };

          await this.appsApi.patchNamespacedDeployment(
            deploymentName,
            namespace,
            rolloutPatch,
            undefined,
            undefined,
            undefined,
            undefined,
            {
              headers: {
                'Content-Type': 'application/strategic-merge-patch+json',
              },
            }
          );
        }
      } catch (error) {
        logger.warn(`Error checking deployment status: ${error}`);
      }
    }

    return deploymentName;
  }

  async createService(namespace: string, config: KubeDeploymentConfig): Promise<void> {
    const serviceName = `${config.serviceId}-service`;

    let serviceManifest: any;
    if (config.serviceType === 'private') {
      serviceManifest = createPrivateServiceServiceManifest(serviceName, config);
    } else if (config.serviceType === 'web') {
      serviceManifest = createWebServiceServiceManifest(serviceName, config);
    } else if (config.serviceType === 'mysql') {
      serviceManifest = createMySqlServiceServiceManifest(serviceName, config);
    } else if (config.serviceType === 'memory') {
      serviceManifest = createMemoryServiceServiceManifest(serviceName, config);
    } else if (config.serviceType === 'postgresql') {
      serviceManifest = createPostgresqlServiceServiceManifest(serviceName, config);
    } else {
      throw new Error(`Unsupported service type: ${config.serviceType}`);
    }

    // Check if service exists
    let serviceExists = false;
    try {
      const existingService = await this.k8sApi.readNamespacedService(serviceName, namespace);
      serviceExists = !!existingService.body;
    } catch (error) {
      serviceExists = false;
    }

    if (!serviceExists) {
      logger.info(`Creating new service for ${config.serviceId}`);
      await this.k8sApi.createNamespacedService(namespace, serviceManifest);
    } else {
      logger.info(`Service ${serviceName} already exists, replacing it`);
      await this.k8sApi.replaceNamespacedService(serviceName, namespace, serviceManifest);
    }
  }

  async createHPA(namespace: string, config: KubeDeploymentConfig): Promise<void> {

    if (config.serviceType !== 'private' && config.serviceType !== 'web') {
      return;
    }

    const hpaName = `${config.serviceId}-hpa`;

    if (!config.scaling || !config.scaling.maxReplicas || !config.scaling.targetCPUUtilizationPercentage || !config.autoScalingEnabled) {
      // Delete HPA if exists
      try {
        await this.customObjectsApi.deleteNamespacedCustomObject('autoscaling', 'v2', namespace, 'horizontalpodautoscalers', hpaName);
      } catch (error) {
        logger.warn(`Error deleting HPA ${hpaName}: ${error}`);
      }

      // No need hpa
      // We already delete if exists
      return;
    }

    let hpaManifest: any;
    if (config.serviceType === 'private') {
      hpaManifest = createPrivateServiceHPAManifest(hpaName, config);
    } else if (config.serviceType === 'web') {
      hpaManifest = createWebServiceHPAManifest(hpaName, config);
    }

    // Check if HPA exists
    let hpaExists = false;
    try {
      const existingHPA = await this.customObjectsApi.getNamespacedCustomObject('autoscaling', 'v2', namespace, 'horizontalpodautoscalers', hpaName);
      hpaExists = !!existingHPA.body;
    } catch (error) {
      // HPA doesn't exist
      hpaExists = false;
    }

    if (!hpaExists) {
      logger.info(`Creating new HPA for ${config.serviceId}`);
      await this.customObjectsApi.createNamespacedCustomObject('autoscaling', 'v2', namespace, 'horizontalpodautoscalers', hpaManifest);
    } else {
      logger.info(`HPA ${hpaName} already exists, replacing it`);
      await this.customObjectsApi.replaceNamespacedCustomObject('autoscaling', 'v2', namespace, 'horizontalpodautoscalers', hpaName, hpaManifest);
    }
  }

  async createStorage(namespace: string, config: KubeDeploymentConfig): Promise<{pvName: string | null, pvcName: string | null}> {

    // const pvName = `${config.serviceId}-pv`;
    const pvcName = `${config.serviceId}-pvc`;

    if (!config.storage || config.storage.size === '') {
      logger.info(`Storage size is 0 for service ${config.serviceId}, deleting any existing PVC and PV`);

      // Try to delete PVC first (this is important as PV may be bound to PVC)
      try {
        await this.k8sApi.deleteNamespacedPersistentVolumeClaim(
          pvcName,
          namespace,
          undefined,
          undefined,
          undefined,
          undefined,
          "Background" // Delete dependent objects in the background
        );

        if (config.deploymentId) {
          await dashboardApi.updateDeploymentLogs({
            deploymentId: config.deploymentId,
            text: `Deleted PersistentVolumeClaim as storage size is 0`
          });
        }

        logger.info(`Successfully deleted PVC ${pvcName}`);
      } catch (error) {
        // PVC may not exist, that's fine
        logger.info(`Could not delete PVC ${pvcName}, it may not exist: ${error}`);
      }

      return { pvName: null, pvcName: null };
    }

    // let pvManifest: any;
    let pvcManifest: any;

    if (config.serviceType === 'private') {
      // pvManifest = createPrivateServicePersistentVolumeManifest(pvName, config);
      pvcManifest = createPrivateServicePersistentVolumeClaimManifest(pvcName, config);
    } else if (config.serviceType === 'web') {
      // pvManifest = createWebServicePersistentVolumeManifest(pvName, config);
      pvcManifest = createWebServicePersistentVolumeClaimManifest(pvcName, config);
    } else if (config.serviceType === 'mysql') {
      // pvManifest = createMySqlServicePersistentVolumeManifest(pvName, config);
      pvcManifest = createMySqlServicePersistentVolumeClaimManifest(pvcName, config);
    } else if (config.serviceType === 'memory') {
      // pvManifest = createMemoryServicePersistentVolumeManifest(pvName, config);
      pvcManifest = createMemoryServicePersistentVolumeClaimManifest(pvcName, config);
    } else if (config.serviceType === 'postgresql') {
      // pvManifest = createPostgresqlServicePersistentVolumeManifest(pvName, config);
      pvcManifest = createPostgresqlServicePersistentVolumeClaimManifest(pvcName, config);
    }

    if (!pvcManifest) {
      logger.info(`Storage size is 0 for service ${config.serviceId}, skipping storage creation`);
      return { pvName: null, pvcName: null };
    }

    // Check if PVC exists and handle creation or update
    // Try to read the PVC first to determine if it exists
    try {
      await this.k8sApi.readNamespacedPersistentVolumeClaim(pvcName, namespace);

      // PVC exists, update the storage size if needed
      logger.info(`PersistentVolumeClaim ${pvcName} exists, updating storage size to ${config.storage?.size}`);

      if (config.storage?.size) {
        // Only patch the storage size field using strategic merge patch
        await this.k8sApi.patchNamespacedPersistentVolumeClaim(
          pvcName,
          namespace,
          {
            spec: {
              resources: {
                requests: {
                  storage: config.storage.size
                }
              }
            }
          },
          undefined,
          undefined,
          undefined,
          undefined,
          {
            headers: {
              'Content-Type': 'application/strategic-merge-patch+json'
            }
          }
        );

        if (config.deploymentId) {
          await dashboardApi.updateDeploymentLogs({
            deploymentId: config.deploymentId,
            text: `Updated PersistentVolumeClaim storage size to ${config.storage.size}`
          });
        }

        // For MySQL services, trigger a deployment update to ensure filesystem expansion takes effect
        if (config.serviceType === 'mysql') {
          logger.info(`MySQL service detected, triggering deployment update to apply filesystem changes`);

          // Wait a moment for the PVC update to propagate
          await new Promise(resolve => setTimeout(resolve, 2000));

          // Get the deployment name
          const deploymentName = `${config.serviceId}-deployment`;

          try {
            // Create a patch with the MySQL deployment complete patch function
            const completePatch = createMySqlServiceDeploymentCompletePatch(config);

            // Apply the patch to the deployment to trigger a rolling update
            await this.appsApi.patchNamespacedDeployment(
              deploymentName,
              namespace,
              completePatch,
              undefined,
              undefined,
              undefined,
              undefined,
              {
                headers: {
                  'Content-Type': 'application/strategic-merge-patch+json'
                }
              }
            );

            if (config.deploymentId) {
              await dashboardApi.updateDeploymentLogs({
                deploymentId: config.deploymentId,
                text: `Triggered MySQL deployment update to apply filesystem changes`
              });
            }

            logger.info(`Successfully triggered update for MySQL service ${config.serviceId}`);
          } catch (error) {
            const errorMessage = `Failed to update MySQL deployment after volume expansion: ${error instanceof Error ? error.message : String(error)}`;
            logger.warn(errorMessage);

            if (config.deploymentId) {
              await dashboardApi.updateDeploymentLogs({
                deploymentId: config.deploymentId,
                text: errorMessage
              });
            }
          }
        }
      }
    } catch (error) {
      // PVC doesn't exist, create a new one
      logger.info(`Creating new PersistentVolumeClaim for service ${config.serviceId} with ${config.storage?.size} storage`);
      try {
        await this.k8sApi.createNamespacedPersistentVolumeClaim(namespace, pvcManifest);
        if (config.deploymentId) {
          await dashboardApi.updateDeploymentLogs({
            deploymentId: config.deploymentId,
            text: `Created PersistentVolumeClaim with ${config.storage?.size} storage`
          });
        }
      } catch (error) {
        const errorMessage = `Failed to create PersistentVolumeClaim for service ${config.serviceId}: ${error instanceof Error ? error.message : String(error)}`;
        logger.error(errorMessage);

        if (config.deploymentId) {
          await dashboardApi.updateDeploymentLogs({
            deploymentId: config.deploymentId,
            text: errorMessage
          });
        }
      }
    }

    return { pvName: null, pvcName };
  }

  async deploy(config: DeployServiceEvent | KubeDeploymentConfig) {
    try {
      const namespace = config.projectId || 'default';

      logger.info(`Deploying service ${config.serviceId} to Kubernetes in namespace ${namespace}`);
      if (config.deploymentId) {
        await dashboardApi.updateDeploymentLogs({
          deploymentId: config.deploymentId,
          text: `Deploying service...`
        });
      }

      // 1. First create namespace if it doesn't exist
      await this.createNamespace(namespace, {
        managedBy: 'kubestrator',
        organization: config.organizationId,
        project: config.projectId,
      });

      // 2. Create or update storage
      await this.createStorage(namespace, config);

      // 3. Create or update the deployment
      const deploymentName = await this.createDeployment(namespace, config);

      // 4. Create or update the service
      await this.createService(namespace, config);

      // 5. Create or update the HPA if auto-scaling is enabled
      await this.createHPA(namespace, config);

      if (config.deploymentId) {
        await dashboardApi.updateDeploymentLogs({
          deploymentId: config.deploymentId,
          text: `Service waiting to be ready...`
        });
      }

      // 6. Wait for deployment to be ready with 30 second timeout
      const isReady = await this.waitForDeploymentReady(deploymentName, namespace, 2*60*1000, config.serviceType);

      if (isReady) {
        logger.info(`Service ${config.serviceId} has been successfully deployed and is ready!`);

        // Update deployment status in Redis (set to active)
        await this.setDeploymentStatus(namespace, deploymentName, true, config.serviceType);

        // Clear crashloop flag if it exists (deployment is now successful)
        try {
          const crashloopKey = `deployment:crashloop:${namespace}:${deploymentName}`;
          await this.statusRedis.del(crashloopKey);
          logger.info(`Cleared crashloop flag for ${namespace}/${deploymentName}`);
        } catch (error) {
          logger.warn(`Could not clear crashloop flag: ${error}`);
        }

        if (config.deploymentId) {
          await dashboardApi.updateDeploymentStatus({
            deploymentId: config.deploymentId,
            status: DeploymentStatus.DEPLOYED,
            logs: {
              text: `Service has been successfully deployed and is ready!`,
              type: 'INFO'
            }
          });
        } else {
          await dashboardApi.updateServiceStatus({
            serviceId: config.serviceId,
            status: ServiceStatus.RUNNING,
          });
        }
      } else {
        logger.error(`Service ${config.serviceId} deployment might not be ready or has failed. Check pod logs for more details.`);

        // Update deployment status in Redis (set to inactive since it failed)
        await this.setDeploymentStatus(namespace, deploymentName, false, config.serviceType);

        if (config.deploymentId) {
          await dashboardApi.updateDeploymentStatus({
            deploymentId: config.deploymentId,
            status: DeploymentStatus.FAILED,
            logs: {
              text: `Service deployment might not be ready or has failed.`,
              type: 'ERROR'
            }
          });
        } else {
          await dashboardApi.updateServiceStatus({
            serviceId: config.serviceId,
            status: ServiceStatus.FAILED,
          });
        }
      }
    } catch (error) {
      logger.error(`Error deploying service: ${error}`);
      if (config.deploymentId) {
        await dashboardApi.updateDeploymentStatus({
          deploymentId: config.deploymentId,
          status: DeploymentStatus.FAILED,
          logs: {
            text: `Deployment error, try again later...`,
            type: 'ERROR'
          }
        });
      } else {
        await dashboardApi.updateServiceStatus({
          serviceId: config.serviceId,
          status: ServiceStatus.FAILED,
        });
      }
      throw error;
    }
  }
}

export { KubeStratorService };
