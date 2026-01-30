# KronJob Service

Scheduled task executor that fetches CronJob configurations from the Go API and executes HTTP requests according to their cron expressions.

## Features

- Fetches CronJobs from Go API on startup
- Schedules jobs using node-cron based on cron expressions
- Executes HTTP requests to specified URLs
- Real-time updates via Redis pub/sub (add/update/delete)
- Configurable concurrent job limits
- Execution history tracking
- Graceful shutdown handling

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

# Redis Channels
REDIS_CHANNEL_CRONJOB_ADDED=cronjob:added
REDIS_CHANNEL_CRONJOB_UPDATED=cronjob:updated
REDIS_CHANNEL_CRONJOB_DELETED=cronjob:deleted

# API Configuration (Go API service)
API_URL=http://127.0.0.1:3000/api
API_KEY=your_api_key_here  # Must match WEBHOOK_API_KEY in Go API

# CronJob Configuration
CRONJOB_FETCH_INTERVAL=300000    # Refresh interval (ms), default: 5 min
MAX_CONCURRENT_JOBS=10           # Max parallel job executions
CRONJOB_TIMEOUT=30000            # Request timeout (ms), default: 30 sec

# Logging
LOG_LEVEL=info
```

## Architecture

### Execution Flow

```
1. Startup: Fetch all enabled CronJobs from Go API
2. Schedule: Register each job with node-cron
3. Execute: When triggered, make HTTP request to job URL
4. Report: Update execution status via Go API
5. Refresh: Periodically sync jobs from API
```

### Why Redis?

Redis is used for real-time synchronization between Go API and KronJob service:

- When a user creates/updates/deletes a CronJob via Dashboard, Go API publishes the event to Redis
- KronJob service subscribes to these channels and immediately updates its schedule
- This eliminates the need to wait for periodic refresh (up to 5 minutes)

### Redis Channels

| Channel | Description |
|---------|-------------|
| `cronjob:added` | New CronJob created |
| `cronjob:updated` | Existing CronJob modified |
| `cronjob:deleted` | CronJob removed |

### Supported Cron Expressions

Standard 5-field cron expressions plus special shortcuts:

| Expression | Description |
|------------|-------------|
| `* * * * *` | Every minute |
| `0 * * * *` | Every hour |
| `0 0 * * *` | Every day at midnight |
| `@yearly` | Once a year (Jan 1, midnight) |
| `@monthly` | Once a month (1st, midnight) |
| `@weekly` | Once a week (Sunday, midnight) |
| `@daily` | Once a day (midnight) |
| `@hourly` | Once an hour |

## Deployment

### Prerequisites

- Node.js 18+
- Access to Redis instance (same as Go API)
- Network access to Go API

### Step 1: Create ECR Repository

```bash
aws ecr create-repository --repository-name kronjob --region <REGION>
```

### Step 2: Build and Push Docker Image

```bash
# Build
docker build -t kronjob:latest .

# Login to ECR
aws ecr get-login-password --region <REGION> | docker login --username AWS --password-stdin <AWS_ACCOUNT_ID>.dkr.ecr.<REGION>.amazonaws.com

# Tag
docker tag kronjob:latest <AWS_ACCOUNT_ID>.dkr.ecr.<REGION>.amazonaws.com/kronjob:latest

# Push
docker push <AWS_ACCOUNT_ID>.dkr.ecr.<REGION>.amazonaws.com/kronjob:latest
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

Edit `k8s/kronjob-secret.yml` and replace placeholders:

```yaml
REDIS_HOST: "<your-redis-host>"
REDIS_PASSWORD: "<your-redis-password>"
API_URL: "<your-api-url>"
API_KEY: "<your-api-key>"
```

### Step 6: Update Deployment Image

Edit `k8s/kronjob-deployment.yaml` and replace `<YOUR_ECR_REGISTRY>`:

```yaml
image: <AWS_ACCOUNT_ID>.dkr.ecr.<REGION>.amazonaws.com/kronjob:latest
```

### Step 7: Deploy to Kubernetes

```bash
kubectl apply -f k8s/
```

### Step 8: Verify Deployment

```bash
kubectl get pods -n system-apps -l app=kronjob
kubectl logs -n system-apps -l app=kronjob
```

## Project Structure

```
kronjob/
├── src/
│   ├── index.ts              # Entry point
│   ├── config/
│   │   └── index.ts          # Configuration management
│   ├── services/
│   │   ├── api.ts            # Go API client
│   │   ├── redis.ts          # Redis pub/sub
│   │   └── scheduler.ts      # Cron scheduling
│   ├── types/
│   │   └── index.ts          # TypeScript types
│   └── utils/
│       └── logger.ts         # Winston logger
├── k8s/
│   ├── kronjob-deployment.yaml
│   ├── kronjob-secret.yml
│   ├── kronjob-pdb.yaml
│   └── kronjob-networkpolicy.yaml
├── Dockerfile
├── package.json
├── tsconfig.json
└── env.example
```

## License

Apache-2.0
