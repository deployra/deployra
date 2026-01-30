# Kubestrator Service

Kubernetes orchestration service that receives deployment events from Go API via Redis queue and manages deployments, services, and resources in Kubernetes.

## Features

- Receives deployment events from Redis queue
- Creates and manages Kubernetes deployments, services, HPAs, PVCs
- Supports multiple service types: web, private, mysql, memory, postgresql
- ECR authentication for private container registries
- CrashLoopBackOff automatic cleanup and scale-down
- Deployment status tracking shared with web-proxy (scale-to-zero support)

## Quick Start

```bash
# Install dependencies
npm install

# Copy environment file
cp env.example .env

# Run in development mode
npm run dev

# Run in production mode
npm run build && npm start
```

## Configuration

Configuration is provided via environment variables. Copy `env.example` to `.env` and configure:

```bash
# Redis Configuration (same Redis as Go API)
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_USERNAME=
REDIS_PASSWORD=
REDIS_QUEUE_NAME=deployment-queue

# Redis for deployment status (shared with web-proxy)
# Used to communicate deployment status to web-proxy for scale-to-zero
STATUS_REDIS_HOST=redis
STATUS_REDIS_PORT=6379
STATUS_REDIS_PASSWORD=
STATUS_REDIS_DB=0

# AWS Configuration
AWS_REGION=us-east-1
AWS_ACCESS_KEY_ID=
AWS_SECRET_ACCESS_KEY=

# Kubernetes Configuration
KUBE_CONFIG_PATH=~/.kube/config

# API Configuration (Go API service)
API_URL=http://127.0.0.1:3000/api
API_KEY=your_api_key_here  # Must match WEBHOOK_API_KEY in Go API

# CrashLoopBackOff Cleanup Configuration
CRASHLOOP_CLEANUP_ENABLED=true
CRASHLOOP_CHECK_INTERVAL_MINUTES=15
CRASHLOOP_MIN_RESTART_COUNT=5

# Logging
LOG_LEVEL=info
```

## Architecture

### Event Flow

```
1. User triggers deployment via Dashboard
2. Go API publishes event to Redis queue (deployment-queue)
3. Kubestrator picks up event from queue
4. Kubestrator creates/updates Kubernetes resources
5. Kubestrator reports status back to Go API
6. Kubestrator updates deployment status in Redis (for web-proxy)
```

### Why Two Redis Connections?

- **Main Redis**: Same Redis as Go API, used for job queue
- **Status Redis**: Shared with web-proxy for deployment status tracking (scale-to-zero feature)

### Supported Service Types

| Type | Description |
|------|-------------|
| `web` | Web services with HTTP endpoint (domain routing via web-proxy) |
| `private` | Internal services without external access |
| `mysql` | MySQL database service |
| `memory` | In-memory cache/database service (Valkey) |
| `postgresql` | PostgreSQL database service |

### CrashLoopBackOff Cleanup

Automatically scales down deployments stuck in problematic states:

- **CrashLoopBackOff**: After configured restart count threshold
- **ImagePullBackOff**: Immediately (image issues)
- **InvalidImageName**: Immediately
- **ErrImagePull**: Immediately

Sets a `deployment:crashloop:{namespace}:{deployment}` flag in Redis to prevent auto scale-up.

## Deployment

### Prerequisites

- Node.js 18+
- Access to Redis instance (same as Go API)
- Kubernetes cluster access with appropriate RBAC permissions
- AWS credentials for ECR access

### Step 1: Create ECR Repository

```bash
aws ecr create-repository --repository-name kubestrator --region <REGION>
```

### Step 2: Build and Push Docker Image

```bash
# Build
docker build -t kubestrator:latest .

# Login to ECR
aws ecr get-login-password --region <REGION> | docker login --username AWS --password-stdin <AWS_ACCOUNT_ID>.dkr.ecr.<REGION>.amazonaws.com

# Tag
docker tag kubestrator:latest <AWS_ACCOUNT_ID>.dkr.ecr.<REGION>.amazonaws.com/kubestrator:latest

# Push
docker push <AWS_ACCOUNT_ID>.dkr.ecr.<REGION>.amazonaws.com/kubestrator:latest
```

### Step 3: Create Namespace

```bash
kubectl create namespace system-apps
```

### Step 4: Create ECR Pull Secret

```bash
kubectl create secret docker-registry ecr-credentials \
  --namespace system-apps \
  --docker-server=<AWS_ACCOUNT_ID>.dkr.ecr.<REGION>.amazonaws.com \
  --docker-username=AWS \
  --docker-password=$(aws ecr get-login-password --region <REGION>)
```

### Step 5: Configure Secrets

Edit `k8s/kubestrator-secret.yaml` and replace placeholders:

```yaml
REDIS_HOST: "<your-redis-host>"
REDIS_PASSWORD: "<your-redis-password>"
API_URL: "<your-api-url>"
API_KEY: "<your-api-key>"
AWS_REGION: "<your-aws-region>"
AWS_ACCESS_KEY_ID: "<your-aws-access-key>"
AWS_SECRET_ACCESS_KEY: "<your-aws-secret-key>"
```

### Step 6: Update Deployment Image

Edit `k8s/kubestrator-deployment.yaml` and replace `<YOUR_ECR_REGISTRY>`:

```yaml
image: <AWS_ACCOUNT_ID>.dkr.ecr.<REGION>.amazonaws.com/kubestrator:latest
```

### Step 7: Deploy to Kubernetes

```bash
kubectl apply -f k8s/
```

### Step 8: Verify Deployment

```bash
kubectl get pods -n system-apps -l app=kubestrator
kubectl logs -n system-apps -l app=kubestrator
```

## Project Structure

```
kubestrator/
├── src/
│   ├── index.ts              # Entry point
│   ├── config/
│   │   └── index.ts          # Configuration management
│   ├── services/
│   │   ├── kubestrator.ts    # Main orchestration service
│   │   ├── ecr-service.ts    # ECR authentication
│   │   ├── web-service.ts    # Web service manifests
│   │   ├── private-service.ts # Private service manifests
│   │   ├── mysql-service.ts  # MySQL service manifests
│   │   ├── memory-service.ts # Memory service manifests (Valkey)
│   │   └── postgresql-service.ts # PostgreSQL service manifests
│   ├── types/
│   │   └── index.ts          # TypeScript types
│   └── utils/
│       ├── logger.ts         # Winston logger
│       └── dashboard-api.ts  # Go API client
├── k8s/
│   ├── kubestrator-deployment.yaml
│   ├── kubestrator-secret.yaml
│   ├── kubestrator-rbac.yaml
│   ├── kubestrator-pdb.yaml
│   └── kubestrator-networkpolicy.yaml
├── Dockerfile
├── package.json
├── tsconfig.json
└── env.example
```

## License

Apache-2.0
