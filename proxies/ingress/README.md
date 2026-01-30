# Ingress Proxy

TCP ingress proxy that forwards traffic from external ports to internal Kubernetes services based on static port mappings.

## Features

- TCP port forwarding to Kubernetes services
- Kubernetes DNS-based service discovery
- DNS caching with configurable TTL
- Connection pooling and buffer management
- Graceful shutdown handling
- Health check endpoint

## Quick Start

```bash
# Build
go build -o ingress-proxy .

# Run locally
./ingress-proxy -config config.json
```

## Configuration

Configuration is provided via JSON file with `-config` flag. If not provided, default values are used.

```json
{
  "idle_timeout": "10m",
  "max_connections": 1000000,
  "connection_timeout": "1s",
  "read_buffer_size": 65536,
  "write_buffer_size": 65536,
  "port_mappings": [
    {
      "port": 80,
      "service_name": "web-proxy-service",
      "service_namespace": "system-apps",
      "service_port": 80
    },
    {
      "port": 443,
      "service_name": "web-proxy-service",
      "service_namespace": "system-apps",
      "service_port": 443
    },
    {
      "port": 3306,
      "service_name": "mysql-proxy-service",
      "service_namespace": "system-apps",
      "service_port": 3306
    },
    {
      "port": 5432,
      "service_name": "postgresql-proxy-service",
      "service_namespace": "system-apps",
      "service_port": 5432
    },
    {
      "port": 6379,
      "service_name": "memory-proxy-service",
      "service_namespace": "system-apps",
      "service_port": 6379
    }
  ]
}
```

## Deployment

### Prerequisites

- AWS CLI configured with appropriate permissions
- Docker installed
- kubectl configured to access your Kubernetes cluster
- Target services (web-proxy, mysql-proxy, etc.) deployed and running

### Step 1: Create ECR Repository

```bash
aws ecr create-repository --repository-name deployra/ingress-proxy --region <REGION>
```

### Step 2: Build and Push Docker Image

```bash
# Build
docker build -t ingress-proxy:latest .

# Login to ECR
aws ecr get-login-password --region <REGION> | docker login --username AWS --password-stdin <AWS_ACCOUNT_ID>.dkr.ecr.<REGION>.amazonaws.com

# Tag
docker tag ingress-proxy:latest <AWS_ACCOUNT_ID>.dkr.ecr.<REGION>.amazonaws.com/deployra/ingress-proxy:latest

# Push
docker push <AWS_ACCOUNT_ID>.dkr.ecr.<REGION>.amazonaws.com/deployra/ingress-proxy:latest
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

### Step 5: Update Deployment Image

Edit `k8s/proxy-deployment.yaml` and replace `<YOUR_ECR_REGISTRY>` with your ECR registry URL:

```yaml
image: <AWS_ACCOUNT_ID>.dkr.ecr.<REGION>.amazonaws.com/deployra/ingress-proxy:latest
```

### Step 6: Deploy to Kubernetes

```bash
kubectl apply -f k8s/
```

### Step 7: Verify Deployment

```bash
kubectl get pods -n system-apps -l app=ingress-proxy
kubectl logs -n system-apps -l app=ingress-proxy
```

## Project Structure

```
ingress/
├── main.go
├── Dockerfile
├── go.mod
├── go.sum
├── pkg/
│   ├── config/
│   │   └── config.go
│   └── proxy/
│       ├── server.go
│       ├── dns.go
│       └── buffer_pool.go
└── k8s/
    ├── proxy-deployment.yaml
    ├── proxy-service.yaml
    └── proxy-networkpolicy.yaml
```

## License

Apache-2.0
