import { KubeDeploymentConfig } from '../types';

export function createPrivateServiceDeploymentManifest(deploymentName: string, config: KubeDeploymentConfig, containerRegistrySecret: string | undefined, envSecretName?: string) {
	
	const manifest = {
		apiVersion: 'apps/v1',
		kind: 'Deployment',
		metadata: {
			name: deploymentName,
			labels: {
				managedBy: 'kubestrator',
				organization: config.organizationId,
				project: config.projectId,
				service: config.serviceId,
				type: config.serviceType,
				deployment: config.deploymentId || '',
			},
		},
		spec: {
			// If storage is attached, force replicas to 1 (RWO PVC can only be mounted by one pod)
			replicas: config.storage ? 1 : (config.scaling?.replicas || config.scaling?.minReplicas || 1),
			selector: {
				matchLabels: {
					service: config.serviceId,
				},
			},
			// If storage is attached, use Recreate strategy (RWO PVC requires single pod)
			// Otherwise use RollingUpdate for zero-downtime deployments
			strategy: config.storage ? {
				type: 'Recreate'
			} : {
				type: 'RollingUpdate',
				rollingUpdate: {
					maxSurge: 1,
					maxUnavailable: 0
				}
			},
			template: {
				metadata: {
					labels: {
						managedBy: 'kubestrator',
						organization: config.organizationId,
						project: config.projectId,
						service: config.serviceId,
						type: config.serviceType,
					},
				},
				spec: {
					enableServiceLinks: false,
					automountServiceAccountToken: false,
					...(config.storage ? {
						initContainers: [
							{
								name: 'resize-filesystem',
								image: 'debian:stable-slim',
								command: ['/bin/sh', '-c'],
								args: [
									'apt-get update && ' +
									'apt-get install -y e2fsprogs && ' +
									'DEVICES=$(lsblk -d -n -o NAME | grep "^sd") && ' +
									'for DEVICE in $DEVICES; do ' +
									'  if [ -b "/dev/$DEVICE" ]; then ' +
									'    echo "Attempting to resize /dev/$DEVICE" && ' +
									'    resize2fs "/dev/$DEVICE" || echo "Failed to resize /dev/$DEVICE" ; ' +
									'  fi; ' +
									'done && ' +
									'chmod -R 777 /data'
								],
								securityContext: {
									privileged: true
								},
								volumeMounts: [
									{
										name: 'data-volume',
										mountPath: '/data'
									}
								]
							}
						],
					} : {}),
					containers: [{
						name: config.serviceId,
						image: config.containerRegistry.imageUri,
						imagePullPolicy: "Always",
						...(config.command && config.command.length > 0 ? { command: config.command } : {}),
						ports: config.ports?.map((port, index) => ({
							containerPort: port.containerPort,
							name: `port-${index}`,
						})) || [{
							containerPort: 3000,
							name: 'port-0',
						}],
						...(envSecretName && {
							envFrom: [
								{
									secretRef: {
										name: envSecretName
									}
								}
							]
						}),
						readinessProbe: config.readinessProbe && config.containerRegistry.type !== 'docker' ? {
							httpGet: {
								path: config.readinessProbe.httpGet.path,
								port: config.readinessProbe.httpGet.port,
							},
							initialDelaySeconds: config.readinessProbe.initialDelaySeconds || 10,
							periodSeconds: config.readinessProbe.periodSeconds || 5,
							timeoutSeconds: 5,
							failureThreshold: 10,
						} : undefined,
						livenessProbe: config.livenessProbe && config.containerRegistry.type !== 'docker' ? {
							httpGet: {
								path: config.livenessProbe.httpGet.path,
								port: config.livenessProbe.httpGet.port,
							},
							initialDelaySeconds: config.livenessProbe.initialDelaySeconds || 30,
							periodSeconds: config.livenessProbe.periodSeconds || 10,
							timeoutSeconds: 5,
							failureThreshold: 3,
						} : undefined,
						resources: config.resources ? {
							requests: config.resources.requests ? {
								cpu: config.resources.requests.cpu || '100m',
								memory: config.resources.requests.memory || '128Mi',
							} : undefined,
							limits: config.resources.limits ? {
								cpu: config.resources.limits.cpu || '500m',
								memory: config.resources.limits.memory || '512Mi',
							} : undefined,
						} : undefined,
						lifecycle: {
							preStop: {
								exec: {
									command: ['sh', '-c', 'sleep 10'], // Wait before pod shutdown
								},
							},
						},
						// Add volumeMounts if storage is configured
						volumeMounts: config.storage ? [
							{
								name: 'data-volume',
								mountPath: '/data' // Default mount path
							}
						] : undefined,
					}],
					imagePullSecrets: [] as { name: string }[],
					terminationGracePeriodSeconds: 30,
					// Add volumes if storage is configured
					volumes: config.storage ? [
						{
							name: 'data-volume',
							persistentVolumeClaim: {
								claimName: `${config.serviceId}-pvc`
							}
						}
					] : undefined,
				},
			},
		},
	};
	
	// Add image pull secret
	if (containerRegistrySecret) {
		manifest.spec.template.spec.imagePullSecrets.push({ name: containerRegistrySecret });
	}

	return manifest;
}

export function createPrivateServiceDeploymentCompletePatch(config: KubeDeploymentConfig, containerRegistrySecretName: string | undefined, envSecretName?: string): any {
  const ports = config.ports?.map((port, index) => ({
		containerPort: port.containerPort,
		name: `port-${index}`,
	})) || [{
		containerPort: 3000,
		name: 'port-0',
	}];

	// Add $patch directive to replace the entire ports array instead of merging
	const portsWithPatchDirective = [
		{ $patch: 'replace' },
		...ports
	];

	const completePatch = {
		spec: {
			template: {
				metadata: {
					annotations: {
						'kubernetes.io/change-cause': `Image update to ${config.containerRegistry.imageUri} at ${new Date().toISOString()}`
					},
				},
				spec: {
					enableServiceLinks: false,
					automountServiceAccountToken: false,
					containers: [
						{
							name: config.serviceId,
							image: config.containerRegistry.imageUri,
							...(config.command && config.command.length > 0 ? { command: config.command } : {}),
							...(config.resources && { resources: config.resources }),
							ports: portsWithPatchDirective,
							...(envSecretName && {
								envFrom: [
									{
										secretRef: {
											name: envSecretName
										}
									}
								]
							}),
							...(config.readinessProbe && config.containerRegistry.type !== 'docker' && {
								readinessProbe: {
									httpGet: {
										path: config.readinessProbe.httpGet.path,
										port: config.readinessProbe.httpGet.port,
									},
									initialDelaySeconds: config.readinessProbe.initialDelaySeconds || 10,
									periodSeconds: config.readinessProbe.periodSeconds || 5,
									timeoutSeconds: 5,
									failureThreshold: 10,
								}
							}),
							...(config.livenessProbe && config.containerRegistry.type !== 'docker' && {
								livenessProbe: {
									httpGet: {
										path: config.livenessProbe.httpGet.path,
										port: config.livenessProbe.httpGet.port,
									},
									initialDelaySeconds: config.livenessProbe.initialDelaySeconds || 30,
									periodSeconds: config.livenessProbe.periodSeconds || 10,
									timeoutSeconds: 5,
									failureThreshold: 3,
								}
							})
						}
					],
					...(containerRegistrySecretName && {
						imagePullSecrets: [{ name: containerRegistrySecretName }]
					})
				}
			},
			// If storage is attached, force replicas to 1 (RWO PVC limitation)
			// Otherwise, if auto scaling is disabled, set replicas from config
			...(config.storage ? {
				replicas: 1
			} : (config.scaling && !config.autoScalingEnabled ? {
				replicas: config.scaling.replicas || config.scaling.minReplicas || 1
			} : {}))
		}
	};

	return completePatch;
}

export function createPrivateServiceServiceManifest(serviceName: string, config: KubeDeploymentConfig) {
	return {
		apiVersion: 'v1',
		kind: 'Service',
		metadata: {
			name: serviceName,
			labels: {
				managedBy: 'kubestrator',
				organization: config.organizationId,
				project: config.projectId,
				service: config.serviceId,
				type: config.serviceType,
				scaleToZeroEnabled: config.scaleToZeroEnabled ? 'true' : 'false',
			},
		},
		spec: {
			selector: {
				service: config.serviceId,
			},
			ports: config.ports?.map((port, index) => ({
				port: port.servicePort,
				targetPort: port.containerPort,
				name: `port-${index}`,
			})) || [{
				port: 80,
				targetPort: 3000,
				name: 'port-0',
			}],
			type: 'ClusterIP',
		},
	};
}

export function createPrivateServiceHPAManifest(hpaName: string, config: KubeDeploymentConfig) {
	return {
		apiVersion: 'autoscaling/v2',
		kind: 'HorizontalPodAutoscaler',
		metadata: {
			name: hpaName,
			namespace: config.projectId || 'default',
			labels: {
				managedBy: 'kubestrator',
				organization: config.organizationId,
				project: config.projectId,
				service: config.serviceId,
				type: config.serviceType,
			}
		},
		spec: {
			scaleTargetRef: {
				apiVersion: 'apps/v1',
				kind: 'Deployment',
				name: `${config.serviceId}-deployment`,
			},
			minReplicas: config.scaling?.minReplicas || 1,
			maxReplicas: config.scaling?.maxReplicas || 10,
			metrics: [
				{
					type: 'Resource',
					resource: {
						name: 'cpu',
						target: {
							type: 'Utilization',
							averageUtilization: config.scaling?.targetCPUUtilizationPercentage,
						},
					},
				},
			],
		},
	};
}

export function createPrivateServicePersistentVolumeManifest(pvName: string, config: KubeDeploymentConfig) {
	return {
		apiVersion: 'v1',
		kind: 'PersistentVolume',
		metadata: {
			name: pvName,
			labels: {
				managedBy: 'kubestrator',
				organization: config.organizationId,
				project: config.projectId,
				service: config.serviceId,
				type: config.serviceType,
			},
		},
		spec: {
			capacity: {
				storage: config.storage?.size || '1Gi',
			},
			accessModes: ['ReadWriteOnce'],
			// storageClassName: config.storage?.storageClass || 'standard',
			storageClassName: 'hcloud-volumes',
		},
	};
}

export function createPrivateServicePersistentVolumeClaimManifest(pvcName: string, config: KubeDeploymentConfig) {
	return {
		apiVersion: 'v1',
		kind: 'PersistentVolumeClaim',
		metadata: {
			name: pvcName,
			labels: {
				managedBy: 'kubestrator',
				organization: config.organizationId,
				project: config.projectId,
				service: config.serviceId,
				type: config.serviceType,
			},
		},
		spec: {
			accessModes: ['ReadWriteOnce'],
			resources: {
				requests: {
					storage: config.storage?.size || '1Gi',
				},
			},
			// storageClassName: config.storage?.storageClass || 'standard',
			storageClassName: 'hcloud-volumes',
		},
	};
}