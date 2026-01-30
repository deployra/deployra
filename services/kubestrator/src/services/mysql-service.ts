import { KubeDeploymentConfig } from '../types';

export function createMysqlConfdConfigMapManifest(config: KubeDeploymentConfig) {
	return {
		apiVersion: 'v1',
		kind: 'ConfigMap',
		metadata: {
			name: `${config.serviceId}-mysql-config`,
			labels: {
				managedBy: 'kubestrator',
				organization: config.organizationId,
				project: config.projectId,
				service: config.serviceId,
			},
		},
		data: {
			"my.cnf": `[mysqld]
authentication_policy=mysql_native_password`
		}
	};
}

export function createMySqlServiceDeploymentManifest(deploymentName: string, config: KubeDeploymentConfig, envSecretName?: string) {
	// Custom images not allowed

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
			replicas: config.scaling?.replicas || config.scaling?.minReplicas || 1,
			selector: {
				matchLabels: {
					service: config.serviceId,
				},
			},
			strategy: {
				type: 'Recreate'
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
							'done'
						  ],
						  securityContext: {
							privileged: true
						  },
						  volumeMounts: [
							{
							  name: 'mysql-data',
							  mountPath: '/var/lib/mysql'
							}
						  ]
						},
					],
					containers: [{
						name: config.serviceId,
						image: 'mysql:8.0',
						imagePullPolicy: "Always",
						ports: config.ports?.map((port, index) => ({
							containerPort: port.containerPort,
							name: `port-${index}`,
						})) || [{
							containerPort: 3306,
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
									command: ['sh', '-c', 'sleep 10'],
								},
							},
						},
						volumeMounts: [
							{
								name: 'mysql-data',
								mountPath: '/var/lib/mysql'
							},
							{
								name: 'mysql-config',
								mountPath: '/etc/mysql/conf.d'
							}
						],
						/*
						readinessProbe: {
							exec: {
								command: ["mysqladmin", "ping", "-h", "localhost"]
							},
							initialDelaySeconds: 30,
							periodSeconds: 10,
							failureThreshold: 3,
						},
						livenessProbe: {
							exec: {
								command: ["mysqladmin", "ping", "-h", "localhost"]
							},
							initialDelaySeconds: 120,
							periodSeconds: 20,
							failureThreshold: 3,
						},
						*/
					}],
					imagePullSecrets: [] as { name: string }[],
					terminationGracePeriodSeconds: 60,
					volumes: [
						{
							name: 'mysql-data',
							persistentVolumeClaim: {
								claimName: `${config.serviceId}-pvc`
							}
						},
						{
							name: 'mysql-config',
							configMap: {
								name: `${config.serviceId}-mysql-config`
							}
						}
					],
				},
			},
		},
	};

	return manifest;
}

export function createMySqlServiceDeploymentCompletePatch(config: KubeDeploymentConfig, envSecretName?: string): any {
	const ports = config.ports?.map((port, index) => ({
		containerPort: port.containerPort,
		name: `port-${index}`,
	})) || [{
		containerPort: 3306,
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
						'kubernetes.io/change-cause': `MySQL configuration update at ${new Date().toISOString()}`,
						'kubestrator.io/storage-updated': config.storage?.size || '0'
					},
				},
				spec: {
					enableServiceLinks: false,
					automountServiceAccountToken: false,
					containers: [
						{
							name: config.serviceId,
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
							})
						}
					],
				}
			},
		},
	};

	return completePatch;
}

export function createMySqlServiceServiceManifest(serviceName: string, config: KubeDeploymentConfig) {
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
				'username-1': config.credentials?.username || undefined,
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
				port: 3306,
				targetPort: 3306,
				name: 'port-0',
			}],
			type: 'ClusterIP',
		},
	};
}

export function createMySqlServicePersistentVolumeManifest(pvName: string, config: KubeDeploymentConfig) {
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
				storage: config.storage?.size || '5Gi', // Default to larger storage for database
			},
			accessModes: ['ReadWriteOnce'],
			storageClassName: config.storage?.storageClass || 'standard',
			hostPath: {
				path: '/mnt/data/' + config.serviceId,
			},
		},
	};
}

export function createMySqlServicePersistentVolumeClaimManifest(pvcName: string, config: KubeDeploymentConfig) {
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
					storage: config.storage?.size || '5Gi', // Default to larger storage for database
				},
			},
			// storageClassName: config.storage?.storageClass || 'standard',
			// volumeName: `${config.serviceId}-pv`,
			storageClassName: 'hcloud-volumes',
		},
	};
}
