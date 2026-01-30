import { KubeDeploymentConfig } from '../types';

export function createMemoryConfigConfigMapManifest(config: KubeDeploymentConfig) {
	const username = config.credentials?.username || 'default';
	const password = config.credentials?.password || 'valkey';

	return {
		apiVersion: 'v1',
		kind: 'ConfigMap',
		metadata: {
			name: `${config.serviceId}-memory-config`,
			labels: {
				managedBy: 'kubestrator',
				organization: config.organizationId,
				project: config.projectId,
				service: config.serviceId,
			},
		},
		data: {
			"valkey.conf": `# Valkey configuration
port 6379
bind 0.0.0.0
protected-mode yes

# Disable default user
user default off

# Configure ACL for service user
user ${username} on >${password} ~* &* +@all

# Security settings
rename-command FLUSHALL ""
rename-command FLUSHDB ""
rename-command DEBUG ""

# Performance
maxmemory-policy volatile-lru

# Persistence
save 900 1
save 300 10
save 60 10000
`
		}
	};
}

export function createMemoryServiceDeploymentManifest(deploymentName: string, config: KubeDeploymentConfig, envSecretName?: string) {
    // Get credentials for Valkey auth
    const username = config.credentials?.username || 'default';
    const password = config.credentials?.password || 'valkey';

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
                    ...(config.storage && config.storage.size ? {
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
                                  name: 'memory-data',
                                  mountPath: '/data'
                                }
                              ]
                            },
                        ],
                    } : {}),
                    containers: [{
                        name: config.serviceId,
                        image: 'valkey/valkey:8-alpine', // Using Valkey 8 Alpine (Redis-compatible)
                        imagePullPolicy: "Always",
                        command: [
                            "valkey-server",
                            "/etc/valkey/valkey.conf"
                        ],
						ports: config.ports?.map((port, index) => ({
							containerPort: port.containerPort,
							name: `port-${index}`,
						})) || [{
							containerPort: 6379,
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
                                    command: ['sh', '-c', 'sleep 10'], // Wait before pod shutdown
                                },
                            },
                        },
                        // Valkey needs persistent storage
                        volumeMounts: [
                            ...(config.storage && config.storage.size ? [{
                                name: 'memory-data',
                                mountPath: '/data'
                            }] : []),
                            {
                                name: 'memory-config',
                                mountPath: '/etc/valkey'
                            }
                        ],
                        // Add Valkey specific readiness and liveness probes
                        readinessProbe: {
                            exec: {
                                command: [
                                    "sh",
                                    "-c",
                                    `valkey-cli --user ${username} --pass ${password} ping`
                                ]
                            },
                            initialDelaySeconds: 10,
                            periodSeconds: 10,
                            failureThreshold: 3,
                        },
                        livenessProbe: {
                            exec: {
                                command: [
                                    "sh",
                                    "-c",
                                    `valkey-cli --user ${username} --pass ${password} ping`
                                ]
                            },
                            initialDelaySeconds: 30,
                            periodSeconds: 20,
                            failureThreshold: 3,
                        },
                    }],
                    imagePullSecrets: [] as { name: string }[],
                    terminationGracePeriodSeconds: 30,
                    // Valkey needs persistent storage
                    volumes: [
                        ...(config.storage && config.storage.size ? [{
                            name: 'memory-data',
                            persistentVolumeClaim: {
                                claimName: `${config.serviceId}-pvc`
                            }
                        }] : []),
                        {
                            name: 'memory-config',
                            configMap: {
                                name: `${config.serviceId}-memory-config`
                            }
                        }
                    ],
                },
            },
        },
    };

    return manifest;
}

export function createMemoryServiceDeploymentCompletePatch(config: KubeDeploymentConfig, envSecretName?: string): any {
    const ports = config.ports?.map((port, index) => ({
		containerPort: port.containerPort,
		name: `port-${index}`,
	})) || [{
		containerPort: 6379,
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
                        'kubernetes.io/change-cause': `Memory (Valkey) configuration update at ${new Date().toISOString()}`,
                        'kubestrator.io/storage-updated': config.storage?.size || '0'
                    },
                },
                spec: {
                    enableServiceLinks: false,
                    automountServiceAccountToken: false,
                    containers: [
                        {
                            name: config.serviceId,
                            ports: portsWithPatchDirective,
                            ...(config.resources && { resources: config.resources }),
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
                    ]
                }
            },
        }
    };

    return completePatch;
}

export function createMemoryServiceServiceManifest(serviceName: string, config: KubeDeploymentConfig) {
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
				port: 6379,
				targetPort: 6379,
				name: 'port-0',
			}],
            type: 'ClusterIP',
        },
    };
}

export function createMemoryServicePersistentVolumeManifest(pvName: string, config: KubeDeploymentConfig) {
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
            storageClassName: config.storage?.storageClass || 'standard',
        },
    };
}

export function createMemoryServicePersistentVolumeClaimManifest(pvcName: string, config: KubeDeploymentConfig) {
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
			// volumeName: `${config.serviceId}-pv`,
			storageClassName: 'hcloud-volumes',
        },
    };
}
