import { KubeDeploymentConfig } from '../types';

export function createPostgresqlConfigMapManifest(config: KubeDeploymentConfig) {
	return {
		apiVersion: 'v1',
		kind: 'ConfigMap',
		metadata: {
			name: `${config.serviceId}-postgresql-config`,
			labels: {
				managedBy: 'kubestrator',
				organization: config.organizationId,
				project: config.projectId,
				service: config.serviceId,
			},
		},
		data: {
			"postgresql.conf": `
# Connection settings
listen_addresses = '*'
max_connections = 100

# Memory settings
shared_buffers = 128MB
work_mem = 4MB

# Query planner settings
effective_cache_size = 1GB

# Logging
log_destination = 'stderr'
logging_collector = on
log_directory = 'pg_log'
log_filename = 'postgresql-%Y-%m-%d_%H%M%S.log'
log_rotation_age = 1d
log_rotation_size = 10MB
log_min_duration_statement = 1000

# Autovacuum settings
autovacuum = on
`
		}
	};
}

export function createPostgresqlServiceDeploymentManifest(deploymentName: string, config: KubeDeploymentConfig, envSecretName?: string) {	
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
							  name: 'postgresql-data',
							  mountPath: '/var/lib/postgresql/data'
							}
						  ]
						},
					],
					containers: [{
						name: config.serviceId,
						image: 'postgres:16.9-alpine3.22',
						imagePullPolicy: "Always",
						ports: config.ports?.map((port, index) => ({
							containerPort: port.containerPort,
							name: `port-${index}`,
						})) || [{
							containerPort: 5432,
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
								name: 'postgresql-data',
								mountPath: '/var/lib/postgresql/data',
								subPath: 'pgdata'
							},
							{
								name: 'postgresql-config',
								mountPath: '/etc/postgresql/conf.d'
							}
						],
						readinessProbe: {
							exec: {
								command: ["pg_isready", "-U", "postgres"]
							},
							initialDelaySeconds: 30,
							periodSeconds: 10,
							failureThreshold: 3,
						},
						livenessProbe: {
							exec: {
								command: ["pg_isready", "-U", "postgres"]
							},
							initialDelaySeconds: 60,
							periodSeconds: 20,
							failureThreshold: 3,
						},
					}],
					imagePullSecrets: [] as { name: string }[],
					terminationGracePeriodSeconds: 60,
					volumes: [
						{
							name: 'postgresql-data',
							persistentVolumeClaim: {
								claimName: `${config.serviceId}-pvc`
							}
						},
						{
							name: 'postgresql-config',
							configMap: {
								name: `${config.serviceId}-postgresql-config`
							}
						}
					],
				},
			},
		},
	};

	return manifest;
}

export function createPostgresqlServiceDeploymentCompletePatch(config: KubeDeploymentConfig, envSecretName?: string): any {
	const ports = config.ports?.map((port, index) => ({
		containerPort: port.containerPort,
		name: `port-${index}`,
	})) || [{
		containerPort: 5432,
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
						'kubernetes.io/change-cause': `PostgreSQL configuration update at ${new Date().toISOString()}`,
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
		}
	};

	return completePatch;
}

export function createPostgresqlServiceServiceManifest(serviceName: string, config: KubeDeploymentConfig) {
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
				port: 5432,
				targetPort: 5432,
				name: 'port-0',
			}],
			type: 'ClusterIP',
		},
	};
}

export function createPostgresqlServicePersistentVolumeManifest(pvName: string, config: KubeDeploymentConfig) {
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

export function createPostgresqlServicePersistentVolumeClaimManifest(pvcName: string, config: KubeDeploymentConfig) {
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
