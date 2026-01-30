package models

// ServiceStatus enum
type ServiceStatus string

const (
	ServiceStatusPending    ServiceStatus = "PENDING"
	ServiceStatusDeploying  ServiceStatus = "DEPLOYING"
	ServiceStatusRunning    ServiceStatus = "RUNNING"
	ServiceStatusStopped    ServiceStatus = "STOPPED"
	ServiceStatusSuspended  ServiceStatus = "SUSPENDED"
	ServiceStatusSleeping   ServiceStatus = "SLEEPING"
	ServiceStatusRestarting ServiceStatus = "RESTARTING"
	ServiceStatusFailed     ServiceStatus = "FAILED"
)

// ServiceScalingStatus enum
type ServiceScalingStatus string

const (
	ServiceScalingStatusIdle    ServiceScalingStatus = "IDLE"
	ServiceScalingStatusScaling ServiceScalingStatus = "SCALING"
)

// EventType enum
type EventType string

const (
	EventTypeDeployStarted           EventType = "DEPLOY_STARTED"
	EventTypeDeployCompleted         EventType = "DEPLOY_COMPLETED"
	EventTypeDeployFailed            EventType = "DEPLOY_FAILED"
	EventTypeDeployCancelled         EventType = "DEPLOY_CANCELLED"
	EventTypeServiceRestartStarted   EventType = "SERVICE_RESTART_STARTED"
	EventTypeServiceRestartCompleted EventType = "SERVICE_RESTART_COMPLETED"
	EventTypeConfigUpdated           EventType = "CONFIG_UPDATED"
	EventTypeServiceScaled           EventType = "SERVICE_SCALED"
	EventTypeServiceScaling          EventType = "SERVICE_SCALING"
)

// DeploymentStatus enum
type DeploymentStatus string

const (
	DeploymentStatusPending   DeploymentStatus = "PENDING"
	DeploymentStatusBuilding  DeploymentStatus = "BUILDING"
	DeploymentStatusBuilded   DeploymentStatus = "BUILDED"
	DeploymentStatusDeploying DeploymentStatus = "DEPLOYING"
	DeploymentStatusDeployed  DeploymentStatus = "DEPLOYED"
	DeploymentStatusFailed    DeploymentStatus = "FAILED"
	DeploymentStatusCancelled DeploymentStatus = "CANCELLED"
)

// LogType enum
type LogType string

const (
	LogTypeStdout  LogType = "STDOUT"
	LogTypeStderr  LogType = "STDERR"
	LogTypeInfo    LogType = "INFO"
	LogTypeWarning LogType = "WARNING"
	LogTypeError   LogType = "ERROR"
)

// PodPhase enum
type PodPhase string

const (
	PodPhasePending   PodPhase = "PENDING"
	PodPhaseRunning   PodPhase = "RUNNING"
	PodPhaseSucceeded PodPhase = "SUCCEEDED"
	PodPhaseFailed    PodPhase = "FAILED"
	PodPhaseUnknown   PodPhase = "UNKNOWN"
)

// ContainerState enum
type ContainerState string

const (
	ContainerStateWaiting    ContainerState = "WAITING"
	ContainerStateRunning    ContainerState = "RUNNING"
	ContainerStateTerminated ContainerState = "TERMINATED"
)

// ContainerStateReason enum
type ContainerStateReason string

const (
	ContainerStateReasonCrashLoopBackOff     ContainerStateReason = "CRASH_LOOP_BACKOFF"
	ContainerStateReasonImagePullBackOff     ContainerStateReason = "IMAGE_PULL_BACKOFF"
	ContainerStateReasonErrImagePull         ContainerStateReason = "ERR_IMAGE_PULL"
	ContainerStateReasonContainerCreating    ContainerStateReason = "CONTAINER_CREATING"
	ContainerStateReasonPodInitializing      ContainerStateReason = "POD_INITIALIZING"
	ContainerStateReasonOOMKilled            ContainerStateReason = "OOM_KILLED"
	ContainerStateReasonCompleted            ContainerStateReason = "COMPLETED"
	ContainerStateReasonError                ContainerStateReason = "ERROR"
	ContainerStateReasonTerminating          ContainerStateReason = "TERMINATING"
	ContainerStateReasonCreateContainerError ContainerStateReason = "CREATE_CONTAINER_ERROR"
)

// Runtime enum
type Runtime string

const (
	RuntimeDocker Runtime = "DOCKER"
	RuntimeImage  Runtime = "IMAGE"
)

// GitProviderType enum
type GitProviderType string

const (
	GitProviderTypeGitHub GitProviderType = "GITHUB"
	GitProviderTypeCustom GitProviderType = "CUSTOM"
)
