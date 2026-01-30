# Deployra API

Go REST API that serves as the backend for Deployra platform. Handles authentication, project management, service deployments, and coordinates with other services via Redis.

## Features

- JWT-based authentication
- GitHub OAuth and GitHub App integration
- Project and service management
- Deployment orchestration via Redis queues
- WebSocket support for real-time updates
- ECR token management for container registry access
- Cronjob management

## Architecture

### Service Communication

```
Dashboard ──HTTP──> API
                        │
                        ├──Redis Queue──> Builder Service
                        ├──Redis Queue──> Kubestrator Service
                        ├──Redis Pub/Sub──> Kronjob Service
                        │
                        └──HTTP Webhooks──< All Services
```

## Deployment

### Prerequisites

- Go 1.21+
- Access to Redis instance
- MySQL 8.0+ database
- AWS credentials for ECR access
- Kubernetes cluster access

### Step 1: Create ECR Repository

```bash
aws ecr create-repository --repository-name api --region <REGION>
```

### Step 2: Build and Push Docker Image

```bash
# Build
docker build -t api:latest .

# Login to ECR
aws ecr get-login-password --region <REGION> | docker login --username AWS --password-stdin <AWS_ACCOUNT_ID>.dkr.ecr.<REGION>.amazonaws.com

# Tag
docker tag api:latest <AWS_ACCOUNT_ID>.dkr.ecr.<REGION>.amazonaws.com/api:latest

# Push
docker push <AWS_ACCOUNT_ID>.dkr.ecr.<REGION>.amazonaws.com/api:latest
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

Edit `k8s/api-secret.yaml` and replace placeholders:

```yaml
DATABASE_URL: "deployra:<MYSQL_PASSWORD>@tcp(mysql.system-apps.svc.cluster.local:3306)/deployra?parseTime=true"
JWT_SECRET: "<JWT_SECRET>"
APP_URL: "<APP_URL>"
API_URL: "<API_URL>"
AWS_REGION: "<AWS_REGION>"
AWS_ACCESS_KEY_ID: "<AWS_ACCESS_KEY_ID>"
AWS_SECRET_ACCESS_KEY: "<AWS_SECRET_ACCESS_KEY>"
REDIS_PASSWORD: "<REDIS_PASSWORD>"
WEBHOOK_API_KEY: "<WEBHOOK_API_KEY>"
CORS_ORIGINS: "<CORS_ORIGINS>"
```

Also configure `k8s/mysql-secret.yaml` and `k8s/redis-secret.yaml`.

### Step 6: Update Deployment Image

Edit `k8s/api-deployment.yaml` and replace `<YOUR_ECR_REGISTRY>`:

```yaml
image: <AWS_ACCOUNT_ID>.dkr.ecr.<REGION>.amazonaws.com/api:latest
```

### Step 7: Deploy to Kubernetes

```bash
kubectl apply -f k8s/
```

### Step 8: Verify Deployment

```bash
kubectl get pods -n system-apps -l app=api
kubectl logs -n system-apps -l app=api
```

## License

Apache-2.0
