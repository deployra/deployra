import * as k8s from '@kubernetes/client-node';
import { logger } from '../utils/logger';
import { 
  updatePodEvent, 
  PodPhase, 
  ContainerState, 
  ContainerStateReason, 
  updateServiceReplicaCount,
  ScalingReason,
  PodMetrics,
  updateServiceMetrics,
  ServiceMetrics,
  StorageMetrics,
  updateStorageMetrics
} from '../utils/dashboard-api';
import { config } from '../config';
import { PassThrough } from 'stream';

export class KuMonitorService {
  private kc: k8s.KubeConfig;
  private metricsClient: k8s.Metrics;
  private k8sApi: k8s.CoreV1Api;
  private metricsResourceCollectionTimer: NodeJS.Timeout | null = null;
  private metricsStorageCollectionTimer: NodeJS.Timeout | null = null;

  constructor() {
    this.kc = new k8s.KubeConfig();
    this.kc.loadFromDefault();
    this.metricsClient = new k8s.Metrics(this.kc);
    this.k8sApi = this.kc.makeApiClient(k8s.CoreV1Api);
  }

  /**
   * Watch Kubernetes deployments with 'managedBy: kubestrator' label across all namespaces
   */
  async watchDeployments() {
    const watch = new k8s.Watch(this.kc);
    
    try {
      watch.watch(
        `/apis/apps/v1/deployments`,
        { labelSelector: 'managedBy=kubestrator' },
        async (type: string, obj: k8s.V1Deployment) => {
          await this.handleDeploymentEvent(type, obj);
        },
        (err: Error) => {
          logger.error('Deployment watch error:', err);
          // Attempt to reconnect after a delay
          setTimeout(() => this.watchDeployments(), 5000);
        }
      );
      
      logger.info('Deployment watcher started');
    } catch (error) {
      logger.error('Failed to start deployment watcher:', error);
      // Attempt to reconnect after a delay
      setTimeout(() => this.watchDeployments(), 5000);
    }
  }

  /**
   * Handle deployment events (ADDED, MODIFIED, DELETED)
   */
  private async handleDeploymentEvent(eventType: string, deployment: k8s.V1Deployment) {
    try {
      if (!deployment.metadata || !deployment.metadata.labels) {
        logger.warn('Deployment metadata or labels are missing');
        return;
      }

      const deploymentName = deployment.metadata.name || 'unknown';
      const labels = deployment.metadata.labels || {};
      
      // Extract service and project identifiers from labels
      const serviceId = labels['service'];
      const deploymentId = labels['deployment'];

      if (!serviceId) {
        logger.warn(`Deployment ${deploymentName} missing required 'service' label`);
        return;
      }

      // Get current and target replica counts
      const currentReplicas = deployment.status?.readyReplicas || 0;
      const targetReplicas = deployment.spec?.replicas || 0;
      
      logger.info(`Deployment event: ${eventType}, Name: ${deploymentName}, Service: ${serviceId}, Current: ${currentReplicas}, Target: ${targetReplicas}`);
      
      // Update the service's currentReplicas field directly
      await updateServiceReplicaCount({
        serviceId,
        currentReplicas,
        targetReplicas,
        deploymentId: deploymentId == '' ? undefined : deploymentId,
        scalingReason: ScalingReason.UNKNOWN,
        scalingMessage: ''
      });
    } catch (error) {
      // logger.error('Error handling deployment event:', error);
    }
  }

  /**
   * Watch Kubernetes pods with 'managedBy: kubestrator' label across all namespaces
   */
  async watchPods() {
    const watch = new k8s.Watch(this.kc);
    try {
      // Watch all pods and filter by label in the callback
      watch.watch(
        `/api/v1/pods`,
        {}, // No label selector in the API call
        async (type: string, obj: k8s.V1Pod) => {
          // Check if the pod has our label
          const labels = obj.metadata?.labels || {};
          if (labels['managedBy'] === 'kubestrator') {
            if (type === 'ADDED' || type === 'MODIFIED' || type === 'DELETED') {
              await this.handlePodEvent(type, obj);
            }
          }
        },
        (err: Error) => {
          logger.error('Pod watch error:', err);
          // Attempt to reconnect after a delay
          setTimeout(() => this.watchPods(), 5000);
        }
      );
      
      logger.info('Pod watcher started');
    } catch (error) {
      logger.error('Failed to start pod watcher:', error);
      // Attempt to reconnect after a delay
      setTimeout(() => this.watchPods(), 5000);
    }
  }

  /**
   * Handle pod events (start/stop)
   */
  private async handlePodEvent(eventType: string, pod: k8s.V1Pod) {
    try {
      if (!pod.metadata) {
        logger.warn('Pod metadata is missing');
        return;
      }

      const podId = pod.metadata.uid || 'unknown';
      const labels = pod.metadata.labels ?? {};
      const k8sPhase = pod.status?.phase ?? 'Unknown';
      
      logger.debug(`Pod event: ${eventType}, Pod: ${podId}, Phase: ${k8sPhase}`);

      // Determine the status and phase of the pod
      const { phase, containerState, containerStateReason } = this.determinePodStatusAndPhase(pod);
      
      // Extract service and deployment identifiers from labels
      const serviceId = labels['service'];
      const deploymentId = labels['deployment'];
      
      if (!serviceId) {
        logger.warn(`Pod ${podId} missing required 'service' label`);
        return;
      }
      
      logger.info(`Pod ${eventType}: ${podId}, Service: ${serviceId}, Phase: ${phase}, Reason: ${containerStateReason || 'N/A'}`);
        
      // Send the event to the dashboard API
      await updatePodEvent({
        eventType,
        podId,
        serviceId,
        deploymentId,
        phase,
        containerState,
        containerStateReason
      });
    } catch (error) {
      // logger.error('Error handling pod event:', error);
    }
  }

  /**
   * Determine the pod phase and container state
   */
  private determinePodStatusAndPhase(pod: k8s.V1Pod): { 
    phase: PodPhase;
    containerState?: ContainerState; 
    containerStateReason?: ContainerStateReason;
  } {
    let phase: PodPhase;
    let containerState: ContainerState | undefined;
    let containerStateReason: ContainerStateReason | undefined;
    
    // Map Kubernetes phase to our enum
    switch (pod.status?.phase) {
      case 'Pending':
        phase = PodPhase.PENDING;
        break;
      case 'Running':
        phase = PodPhase.RUNNING;
        break;
      case 'Succeeded':
        phase = PodPhase.SUCCEEDED;
        break;
      case 'Failed':
        phase = PodPhase.FAILED;
        break;
      default:
        phase = PodPhase.UNKNOWN;
    }
    
    // Check for Terminating status (pod has a deletionTimestamp)
    if (pod.metadata?.deletionTimestamp) {
      containerStateReason = ContainerStateReason.TERMINATING;
    }
    
    // Check container statuses for more detailed information
    const containerStatuses = pod.status?.containerStatuses || [];
    
    for (const containerStatus of containerStatuses) {
      // Check for container waiting state
      const waiting = containerStatus.state?.waiting;
      if (waiting && waiting.reason) {
        containerState = ContainerState.WAITING;
        logger.debug(`Container waiting reason: ${waiting.reason}`);
        
        // Map the reason to our enum
        switch (waiting.reason) {
          case 'CrashLoopBackOff':
            containerStateReason = ContainerStateReason.CRASH_LOOP_BACKOFF;
            break;
          case 'ImagePullBackOff':
            containerStateReason = ContainerStateReason.IMAGE_PULL_BACKOFF;
            break;
          case 'ErrImagePull':
            containerStateReason = ContainerStateReason.ERR_IMAGE_PULL;
            break;
          case 'ContainerCreating':
            containerStateReason = ContainerStateReason.CONTAINER_CREATING;
            break;
          case 'PodInitializing':
            containerStateReason = ContainerStateReason.POD_INITIALIZING;
            break;
          case 'CreateContainerError':
            containerStateReason = ContainerStateReason.CREATE_CONTAINER_ERROR;
            break;
        }
      }
      
      // Check for running state
      if (containerStatus.state?.running) {
        containerState = ContainerState.RUNNING;
      }
      
      // Check for terminated state
      const terminated = containerStatus.state?.terminated;
      if (terminated) {
        containerState = ContainerState.TERMINATED;
        
        if (terminated.reason === 'Completed') {
          containerStateReason = ContainerStateReason.COMPLETED;
        } else if (terminated.reason === 'Error') {
          containerStateReason = ContainerStateReason.ERROR;
        } else if (terminated.reason === 'OOMKilled') {
          containerStateReason = ContainerStateReason.OOM_KILLED;
        }
      }
    }
    
    return { phase, containerState, containerStateReason };
  }

  /**
   * Collect metrics from all pods with 'managedBy=kubestrator' label
   */
  async collectPodMetrics() {
    try {
      logger.debug('Collecting pod metrics...');
      
      // Get all pods with the required label
      const podsResponse = await this.k8sApi.listPodForAllNamespaces(
        undefined, // allowWatchBookmarks
        undefined, // _continue
        undefined, // fieldSelector
        config.kubernetes.labelSelector // labelSelector
      );
      
      const pods = podsResponse.body.items;
      logger.debug(`Found ${pods.length} pods with label ${config.kubernetes.labelSelector}`);
      
      if (pods.length === 0) {
        return;
      }
      
      // Extract all unique services from pod labels
      const serviceIds = new Set<string>();
      for (const pod of pods) {
        const labels = pod.metadata?.labels || {};
        const serviceId = labels['service'];
        if (serviceId) {
          serviceIds.add(serviceId);
        }
      }
      
      logger.debug(`Found ${serviceIds.size} unique services: ${Array.from(serviceIds).join(', ')}`);
      
      // Get pod metrics from the metrics API
      const podMetricsResponse = await this.metricsClient.getPodMetrics();
      
      // Group pods by service
      const podsByService: Record<string, k8s.V1Pod[]> = {};
      for (const serviceId of serviceIds) {
        podsByService[serviceId] = pods.filter(pod => 
          pod.metadata?.labels?.['service'] === serviceId
        );
        logger.debug(`Service ${serviceId} has ${podsByService[serviceId].length} pods`);
      }
      
      // Collect metrics for each service
      const serviceMetricsMap: Record<string, {
        serviceId: string,
        deploymentId?: string,
        totalCpuUsage: number,
        totalMemoryUsage: number,
        totalCpuLimit: number,
        totalMemoryLimit: number,
        pods: PodMetrics[]
      }> = {};
          
      // Initialize service metrics
      for (const serviceId of serviceIds) {
        serviceMetricsMap[serviceId] = {
          serviceId,
          deploymentId: undefined, // Will be set from pod labels
          totalCpuUsage: 0,
          totalMemoryUsage: 0,
          totalCpuLimit: 0,
          totalMemoryLimit: 0,
          pods: []
        };
      }
      
      // Process each service and its pods
      for (const [serviceId, servicePods] of Object.entries(podsByService)) {
        // Process each pod for this service
        for (const pod of servicePods) {
          try {
            if (!pod.metadata || !pod.metadata.name || !pod.metadata.namespace) {
              continue;
            }

            const podName = pod.metadata.name;
            const namespace = pod.metadata.namespace;
            const podId = pod.metadata.uid || '';
            const labels = pod.metadata.labels || {};
            
            // Get deployment ID from labels
            const deploymentId = labels['deployment'];

            // Update service metrics with deployment ID if not set yet
            if (deploymentId && !serviceMetricsMap[serviceId].deploymentId) {
              serviceMetricsMap[serviceId].deploymentId = deploymentId;
            }
            
            // Find the pod metrics
            const podMetrics = podMetricsResponse.items.find(
              (m) => m.metadata && m.metadata.name === podName && m.metadata.namespace === namespace
            );
            
            if (!podMetrics) {
              logger.debug(`No metrics found for pod ${podName} in namespace ${namespace}`);
              continue;
            }
            
            // Calculate total CPU and memory usage for the pod
            let cpuUsage = 0;
            let memoryUsage = 0;
            let cpuLimit = 0;
            let memoryLimit = 0;
            
            // Sum up container metrics
            for (const container of podMetrics.containers) {
              // CPU usage (convert from Kubernetes format to millicores)
              const containerCpuUsage = this.parseCpuMetric(container.usage.cpu);
              cpuUsage += containerCpuUsage;
              
              // Memory usage (convert from Kubernetes format to bytes)
              const containerMemoryUsage = this.parseMemoryMetric(container.usage.memory);
              memoryUsage += containerMemoryUsage;
            }
            
            // Get resource limits from pod spec
            const containers = pod.spec?.containers || [];
            for (const container of containers) {
              if (container.resources?.limits) {
                // CPU limit
                if (container.resources.limits.cpu) {
                  cpuLimit += this.parseCpuMetric(container.resources.limits.cpu);
                }
                
                // Memory limit
                if (container.resources.limits.memory) {
                  memoryLimit += this.parseMemoryMetric(container.resources.limits.memory);
                }
            }
          }

            // Create the pod metrics object
            const podMetricsObj: PodMetrics = {
              podId,
              cpuUsage,
              memoryUsage,
              cpuLimit: cpuLimit > 0 ? cpuLimit : undefined,
              memoryLimit: memoryLimit > 0 ? memoryLimit : undefined
            };
            
            // Add to service's pods array
            serviceMetricsMap[serviceId].pods.push(podMetricsObj);
            
            // Update service metrics aggregation
            serviceMetricsMap[serviceId].totalCpuUsage += cpuUsage;
            serviceMetricsMap[serviceId].totalMemoryUsage += memoryUsage;
            
            // Only add limits if they exist
            if (cpuLimit > 0 && memoryLimit > 0) {
              serviceMetricsMap[serviceId].totalCpuLimit += cpuLimit;
              serviceMetricsMap[serviceId].totalMemoryLimit += memoryLimit;
            }
            
          } catch (podError) {
            logger.error(`Error collecting metrics for pod ${pod.metadata?.name}:`, podError);
          }
        }
      }
      
      // Calculate final service metrics
      const serviceMetrics: ServiceMetrics[] = [];
      
      for (const [serviceId, metrics] of Object.entries(serviceMetricsMap)) {
        if (metrics.pods.length === 0) {
          continue; // Skip services with no pods
        }
        
        // Calculate averages
        const avgCpuUsage = Number((metrics.totalCpuUsage / metrics.pods.length).toFixed(2));
        const avgMemoryUsage = Number((metrics.totalMemoryUsage / metrics.pods.length).toFixed(2));
        
        // Calculate utilization percentages if limits exist
        let cpuUtilizationPercentage: number | undefined;
        let memoryUtilizationPercentage: number | undefined;
        
        // Calculate utilization as percentage of limit
        if (metrics.totalCpuLimit > 0 && metrics.totalMemoryLimit > 0) {
          cpuUtilizationPercentage = Number(((metrics.totalCpuUsage / metrics.totalCpuLimit) * 100).toFixed(2));
          memoryUtilizationPercentage = Number(((metrics.totalMemoryUsage / metrics.totalMemoryLimit) * 100).toFixed(2));
        
          if (cpuUtilizationPercentage > 100) {
            logger.warn(`CPU utilization percentage for service ${serviceId} is over 100%: ${cpuUtilizationPercentage}% (raw values: usage=${metrics.totalCpuUsage}, limit=${metrics.totalCpuLimit})`);
            continue;
          }
        
          if (memoryUtilizationPercentage > 100) {
            logger.warn(`Memory utilization percentage for service ${serviceId} is over 100%: ${memoryUtilizationPercentage}% (raw values: usage=${metrics.totalMemoryUsage}, limit=${metrics.totalMemoryLimit})`);
            continue;
          }
        }
        
        // Create service metrics object
        const serviceMetricsObj: ServiceMetrics = {
          serviceId,
          deploymentId: metrics.deploymentId,
          totalCpuUsage: metrics.totalCpuUsage,
          avgCpuUsage,
          totalMemoryUsage: metrics.totalMemoryUsage,
          avgMemoryUsage,
          cpuUtilizationPercentage,
          memoryUtilizationPercentage,
          pods: metrics.pods
        };
        
        serviceMetrics.push(serviceMetricsObj);
      }
      
      // Send service-level metrics to the dashboard API (which now include pod metrics)
      if (serviceMetrics.length > 0) {
        await updateServiceMetrics(serviceMetrics);
        // logger.info(`Sent service metrics for ${serviceMetrics.length} services`);
      }
      
    } catch (error) {
      // logger.error('Error collecting pod metrics:', error);
    }
  }
  
  /**
   * Collect storage metrics from PVCs associated with services managed by kubestrator
   */
  private async collectStorageMetrics() {
    try {
      // Get all pods with the required label
      const podsResponse = await this.k8sApi.listPodForAllNamespaces(
        undefined, // allowWatchBookmarks
        undefined, // _continue
        undefined, // fieldSelector
        config.kubernetes.labelSelector // labelSelector
      );

      const pods = podsResponse.body.items;
      
      logger.debug(`Found ${pods.length} pods with managedBy=kubestrator label`);

      // Get all PVCs across all namespaces
      const { body: pvcList } = await this.k8sApi.listPersistentVolumeClaimForAllNamespaces();

      // Map to track which pods use which PVCs
      const pvcToPods: Record<string, k8s.V1Pod[]> = {};
      const podMountPaths: Record<string, Record<string, string>> = {}; // podName -> { pvcName -> mountPath }

      // For each pod, find its associated PVCs and mount paths
      for (const pod of pods) {
        const podName = pod.metadata?.name || '';
        const namespace = pod.metadata?.namespace || '';
        
        if (!podName || !namespace) continue;
        
        // Get volumes from pod spec
        const volumes = pod.spec?.volumes || [];
        const volumeMounts = pod.spec?.containers?.[0]?.volumeMounts || [];
        
        // For each volume, check if it's a PVC
        for (const volume of volumes) {
          if (volume.persistentVolumeClaim && volume.persistentVolumeClaim.claimName) {
            const claimName = volume.persistentVolumeClaim.claimName;
            const pvcKey = `${namespace}/${claimName}`;
            
            // Find the mount path for this volume
            const volumeMount = volumeMounts.find(vm => vm.name === volume.name);
            if (volumeMount && volumeMount.mountPath) {
              // Store the mount path for this PVC in this pod
              if (!podMountPaths[podName]) {
                podMountPaths[podName] = {};
              }
              podMountPaths[podName][claimName] = volumeMount.mountPath;
              
              // Associate this pod with the PVC
              if (!pvcToPods[pvcKey]) {
                pvcToPods[pvcKey] = [];
              }
              pvcToPods[pvcKey].push(pod);
            }
          }
        }
      }

      // Group PVCs by service
      const storageByService: Record<string, {
        serviceId: string,
        pvcs: {
          name: string,
          namespace: string,
          storageUsage: number,
          actualUsage: number,
          storageLimit: number
        }[]
      }> = {};
      
      // Process each PVC and associate it with a service
      for (const pvc of pvcList.items) {
        const name = pvc.metadata?.name;
        const namespace = pvc.metadata?.namespace;
        const labels = pvc.metadata?.labels || {};
        const service = labels['service'];
        
        if (!name || !namespace || !service) {
          continue;
        }
        
        const pvcKey = `${namespace}/${name}`;
        
        // Initialize service storage metrics if not already done
        if (!storageByService[service]) {
          storageByService[service] = {
            serviceId: service,
            pvcs: []
          };
        }
        
        // Get storage capacity and usage
        let storageUsage = 0;
        let storageLimit = 0;
        let actualUsage = 0;
        
        // Get storage capacity from PVC status (allocated space)
        if (pvc.status?.capacity?.storage) {
          storageUsage = this.parseMemoryMetric(pvc.status.capacity.storage);
        }
        
        // Get storage limit from PVC spec
        if (pvc.spec?.resources?.requests?.storage) {
          storageLimit = this.parseMemoryMetric(pvc.spec.resources.requests.storage);
        } else if (storageUsage > 0) {
          // If no request specified, use capacity as limit
          storageLimit = storageUsage;
        }
        
        // Try to get actual disk usage by executing a command in the pod
        const podsUsingPvc = pvcToPods[pvcKey] || [];
        if (podsUsingPvc.length > 0) {
          // Use the first pod that mounts this PVC
          const pod = podsUsingPvc[0];
          const podName = pod.metadata?.name || '';
          const mountPath = podMountPaths[podName]?.[name];
          
          if (podName && mountPath) {
            try {
              // Execute df command in the pod to get actual disk usage
              const exec = new k8s.Exec(this.kc);
              // Use a simpler df command that works with BusyBox
              const command = ['df', '-k', mountPath];
              
              // Execute the command and capture output
              const { stdout, stderr } = await this.execCommandInPod(
                exec, 
                namespace, 
                podName, 
                command, 
                pod.spec?.containers?.[0]?.name || 'app'
              );

              if (stdout.length > 0 && stderr.length === 0) {
                // Parse the output to get actual usage in bytes
                // Output format for BusyBox df is:
                // Filesystem           1k-blocks      Used Available Use% Mounted on
                // /dev/sda1              9983232   1348272   8634960  14% /
                
                const lines = stdout.trim().split('\n');
                if (lines.length >= 2) {
                  const parts = lines[1].trim().split(/\s+/);
                  if (parts.length >= 3) {
                    // Used is in 1k blocks, convert to bytes
                    const usedKilobytes = parseInt(parts[2], 10);
                    if (!isNaN(usedKilobytes)) {
                      actualUsage = usedKilobytes * 1024; // Convert KB to bytes
                    }
                  }
                }
              }
            } catch (execError) {
              logger.warn(`Failed to get actual disk usage for PVC ${name} in pod ${podName}: ${execError}`);
            }
          }
        }

        // Add individual PVC info
        storageByService[service].pvcs.push({
          name,
          namespace,
          storageUsage,  // This is the allocated capacity
          actualUsage,   // This is the actual disk usage
          storageLimit
        });
      }
      
      // Create final storage metrics
      const storageMetrics: StorageMetrics[] = [];
      
      for (const [serviceId, metrics] of Object.entries(storageByService)) {
        // Skip services with no PVCs
        if (metrics.pvcs.length === 0) {
          continue;
        }

        // Create storage metrics object
        const storageMetricsObj: StorageMetrics = {
          serviceId,
          pvcs: metrics.pvcs.map(pvc => ({
            name: pvc.name,
            namespace: pvc.namespace,
            storageUsage: pvc.actualUsage, // Use actual usage as the primary metric
            storageLimit: pvc.storageLimit,
            storageUtilizationPercentage: pvc.actualUsage > 0 ? (pvc.actualUsage / pvc.storageLimit) * 100 : undefined
          }))
        };
        
        storageMetrics.push(storageMetricsObj);
      }
      
      // Send storage metrics to the dashboard API
      if (storageMetrics.length > 0) {
        await updateStorageMetrics(storageMetrics);
        logger.info(`Sent storage metrics for ${storageMetrics.length} services`);
      }
      
    } catch (error) {
      logger.error('Error collecting storage metrics:', error);
    }
  }

  /**
   * Execute a command in a pod and return stdout and stderr
   * This uses kubectl exec under the hood for simplicity and reliability
   */
  private async execCommandInPod(
    exec: k8s.Exec,
    namespace: string,
    podName: string,
    command: string[],
    containerName: string
  ): Promise<{ stdout: string; stderr: string }> {
    try {
      const stdoutStream = new PassThrough();
      const stderrStream = new PassThrough();

      let stdout = '';
      let stderr = '';

      stdoutStream.on('data', (chunk) => {
        stdout += chunk.toString();
      });
    
      stderrStream.on('data', (chunk) => {
        stderr += chunk.toString();
      });

      await new Promise<void>((resolve, reject) => {
        exec.exec(
          namespace,
          podName,
          containerName,
          command,
          stdoutStream,
          stderrStream,
          null,
          false,
          (status: k8s.V1Status) => {
            if (status?.status === 'Success') {
              resolve();
            } else {
              reject(new Error(JSON.stringify(status)));
            }
          }
        ).catch(reject);
      });

      return { stdout, stderr };
    } catch (error) {
      logger.error('Error executing command in pod:', error);
      return { stdout: '', stderr: error instanceof Error ? error.message : String(error) };
    }
  }

  /**
   * Parse CPU metric from Kubernetes format to millicores
   * Examples: "100m" -> 100, "0.1" -> 100, "1" -> 1000
   */
  private parseCpuMetric(cpuStr: string): number {
    if (!cpuStr) return 0;
    
    // Check if the value is in millicores format (e.g., "100m")
    if (cpuStr.endsWith('m')) {
      return parseInt(cpuStr.slice(0, -1), 10) || 0;
    }
    
    if (cpuStr.endsWith('n')) {
      return Math.round(parseInt(cpuStr.slice(0, -1), 10) / 1_000_000);
    }

    // Convert from cores to millicores (e.g., "0.1" -> 100)
    const cores = parseFloat(cpuStr);
    return Math.round(cores * 1000);
  }
  
  /**
   * Parse memory metric from Kubernetes format to bytes
   * Examples: "100Mi" -> 104857600, "1Gi" -> 1073741824
   */
  private parseMemoryMetric(memoryStr: string): number {
    if (!memoryStr) return 0;
    
    // Remove any whitespace
    memoryStr = memoryStr.trim();
    
    // Check for binary units (Ki, Mi, Gi, Ti, Pi, Ei)
    if (memoryStr.endsWith('Ki')) {
      return parseInt(memoryStr.slice(0, -2), 10) * 1024;
    } else if (memoryStr.endsWith('Mi')) {
      return parseInt(memoryStr.slice(0, -2), 10) * 1024 * 1024;
    } else if (memoryStr.endsWith('Gi')) {
      return parseInt(memoryStr.slice(0, -2), 10) * 1024 * 1024 * 1024;
    } else if (memoryStr.endsWith('Ti')) {
      return parseInt(memoryStr.slice(0, -2), 10) * 1024 * 1024 * 1024 * 1024;
    }
    
    // Check for decimal units (K, M, G, T, P, E)
    if (memoryStr.endsWith('K')) {
      return parseInt(memoryStr.slice(0, -1), 10) * 1000;
    } else if (memoryStr.endsWith('M')) {
      return parseInt(memoryStr.slice(0, -1), 10) * 1000 * 1000;
    } else if (memoryStr.endsWith('G')) {
      return parseInt(memoryStr.slice(0, -1), 10) * 1000 * 1000 * 1000;
    } else if (memoryStr.endsWith('T')) {
      return parseInt(memoryStr.slice(0, -1), 10) * 1000 * 1000 * 1000 * 1000;
    }
    
    // If no unit, assume bytes
    return parseInt(memoryStr, 10);
  }
  
  /**
   * Start the metrics resource collection timer
   */
  startMetricsResourceCollection() {
    if (!config.metrics.enabled) {
      logger.info('Metrics collection is disabled');
      return;
    }
    
    const intervalMs = config.metrics.resourceCollectionIntervalSeconds * 1000;
    logger.info(`Starting resource metrics collection (interval: ${config.metrics.resourceCollectionIntervalSeconds}s)`);
    
    // Clear any existing timer
    if (this.metricsResourceCollectionTimer) {
      clearInterval(this.metricsResourceCollectionTimer);
    }
    
    // Start the timer
    this.metricsResourceCollectionTimer = setInterval(async () => {
      await this.collectPodMetrics();
    }, intervalMs);
    
    // Collect metrics immediately
    this.collectPodMetrics().catch(err => {
      logger.error('Error in initial metrics collection:', err);
    });
  }

  /**
   * Start the metrics storage collection timer
   */
  startMetricsStorageCollection() {
    if (!config.metrics.enabled) {
      logger.info('Metrics collection is disabled');
      return;
    }
    
    const intervalMs = config.metrics.storageCollectionIntervalSeconds * 1000;
    logger.info(`Starting storage metrics collection (interval: ${config.metrics.storageCollectionIntervalSeconds}s)`);
    
    // Clear any existing timer
    if (this.metricsStorageCollectionTimer) {
      clearInterval(this.metricsStorageCollectionTimer);
    }

    // Start the timer
    this.metricsStorageCollectionTimer = setInterval(async () => {
      await this.collectStorageMetrics();
    }, intervalMs);
    
    // Collect metrics immediately
    this.collectStorageMetrics().catch(err => {
      logger.error('Error in initial metrics collection:', err);
    });
  }
  
  /**
   * Stop the metrics resource collection timer
   */
  stopMetricsResourceCollection() {
    if (this.metricsResourceCollectionTimer) {
      clearInterval(this.metricsResourceCollectionTimer);
      this.metricsResourceCollectionTimer = null;
      logger.info('Metrics resource collection stopped');
    }
  }

  /**
   * Stop the metrics storage collection timer
   */
  stopMetricsStorageCollection() {
    if (this.metricsStorageCollectionTimer) {
      clearInterval(this.metricsStorageCollectionTimer);
      this.metricsStorageCollectionTimer = null;
      logger.info('Metrics storage collection stopped');
    }
  }

  /**
   * Start monitoring deployments and pods
   */
  async start() {
    logger.info('KuMonitor service starting...');
    await this.watchDeployments();
    await this.watchPods();
    this.startMetricsResourceCollection();
    this.startMetricsStorageCollection();
  }
  
  /**
   * Stop all monitoring activities
   */
  stop() {
    this.stopMetricsResourceCollection();
    this.stopMetricsStorageCollection();
    logger.info('KuMonitor service stopped');
  }
}

// Singleton instance
export const kuMonitorService = new KuMonitorService();
