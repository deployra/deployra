# KuMonitor Service

Kubernetes monitoring service that watches deployments and pods, tracking changes and reporting metrics to the Go API.

## Features

- Watches deployments with `managedBy: kubestrator` label
- Tracks pod lifecycle events (creation, termination, state changes)
- Collects CPU and memory metrics from pods
- Collects storage/PVC usage metrics
- Aggregates metrics by service
- Reports utilization percentages based on resource limits
- Real-time event reporting to Go API

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
# Kubernetes Configuration
KUBE_CONFIG_PATH=~/.kube/config

# API Configuration (Go API service)
API_URL=http://127.0.0.1:3000/api
API_KEY=your_api_key_here  # Must match WEBHOOK_API_KEY in Go API

# Metrics Collection Configuration
METRICS_RESOURCE_COLLECTION_INTERVAL_SECONDS=60   # CPU/Memory collection interval
METRICS_STORAGE_COLLECTION_INTERVAL_SECONDS=300   # Storage/PVC collection interval
METRICS_COLLECTION_ENABLED=true

# Logging
LOG_LEVEL=info
```

## Metrics Collection

### Service-Level Metrics
- Total CPU usage across all pods (millicores)
- Average CPU usage per pod (millicores)
- Total memory usage across all pods (bytes)
- Average memory usage per pod (bytes)
- Pod count
- CPU utilization percentage (if limits are set)
- Memory utilization percentage (if limits are set)

### Pod-Level Metrics
- CPU usage (millicores)
- CPU limits (if configured)
- Memory usage (bytes)
- Memory limits (if configured)

### Storage Metrics
- PVC usage per service
- Storage utilization percentage

## Deployment

### Prerequisites

- Node.js 18+
- Kubernetes cluster access with appropriate RBAC permissions
- Network access to Go API

### Step 1: Create ECR Repository

```bash
aws ecr create-repository --repository-name kumonitor --region <REGION>
```

### Step 2: Build and Push Docker Image

```bash
# Build
docker build -t kumonitor:latest .

# Login to ECR
aws ecr get-login-password --region <REGION> | docker login --username AWS --password-stdin <AWS_ACCOUNT_ID>.dkr.ecr.<REGION>.amazonaws.com

# Tag
docker tag kumonitor:latest <AWS_ACCOUNT_ID>.dkr.ecr.<REGION>.amazonaws.com/kumonitor:latest

# Push
docker push <AWS_ACCOUNT_ID>.dkr.ecr.<REGION>.amazonaws.com/kumonitor:latest
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

Edit `k8s/monitor-secret.yml` and replace placeholders:

```yaml
API_URL: "<your-api-url>"
API_KEY: "<your-api-key>"
```

### Step 6: Update Deployment Image

Edit `k8s/monitor-deployment.yaml` and replace `<YOUR_ECR_REGISTRY>`:

```yaml
image: <AWS_ACCOUNT_ID>.dkr.ecr.<REGION>.amazonaws.com/kumonitor:latest
```

### Step 7: Deploy to Kubernetes

```bash
kubectl apply -f k8s/
```

### Step 8: Verify Deployment

```bash
kubectl get pods -n system-apps -l app=kumonitor
kubectl logs -n system-apps -l app=kumonitor
```

## Project Structure

```
kumonitor/
├── src/
│   ├── index.ts              # Entry point
│   ├── config/
│   │   └── index.ts          # Configuration management
│   ├── services/
│   │   └── monitor.ts        # Main monitoring service
│   └── utils/
│       ├── logger.ts         # Winston logger
│       └── dashboard-api.ts  # Go API client
├── k8s/
│   ├── monitor-deployment.yaml
│   ├── monitor-secret.yml
│   ├── monitor-rbac.yaml
│   ├── monitor-pdb.yaml
│   └── monitor-networkpolicy.yaml
├── Dockerfile
├── package.json
├── tsconfig.json
└── env.example
```

## License

Apache-2.0
