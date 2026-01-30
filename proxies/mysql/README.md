# MySQL Proxy

TCP proxy that routes MySQL connections to appropriate Kubernetes services based on the MySQL username extracted from the handshake.

## Features

- Watches Kubernetes services with configurable label selector
- Extracts username from MySQL handshake packets
- Routes connections based on username-to-service mappings
- DNS caching with configurable TTL
- Connection pooling and buffer management
- Graceful shutdown handling

## Quick Start

```bash
# Build
go build -o mysql-proxy .

# Run locally
./mysql-proxy -config config.json
```

## Configuration

Configuration is provided via JSON file with `-config` flag. If not provided, default values are used.

```json
{
  "listen_addr": ":3306",
  "kube_config_path": "",
  "label_selector": "deployra.com/service-type=mysql",
  "max_connections": 1000000,
  "connection_timeout": "1s",
  "read_buffer_size": 65536,
  "write_buffer_size": 65536,
  "use_proxy_proto": false
}
```

### User Mapping

MySQL services must have annotations that map usernames to the service. The proxy watches services and builds a routing table based on these annotations.

```yaml
apiVersion: v1
kind: Service
metadata:
  name: mysql-users
  labels:
    app: mysql
  annotations:
    deployra.com/mysql-usernames: "user_admin,user_reader"
spec:
  ports:
    - port: 3306
```

## Deployment

### Prerequisites

- AWS CLI configured with appropriate permissions
- Docker installed
- kubectl configured to access your Kubernetes cluster
- MySQL instances deployed as services with appropriate labels and annotations

### Step 1: Create ECR Repository

```bash
aws ecr create-repository --repository-name deployra/mysql-proxy --region <REGION>
```

### Step 2: Build and Push Docker Image

```bash
# Build
docker build -t mysql-proxy:latest .

# Login to ECR
aws ecr get-login-password --region <REGION> | docker login --username AWS --password-stdin <AWS_ACCOUNT_ID>.dkr.ecr.<REGION>.amazonaws.com

# Tag
docker tag mysql-proxy:latest <AWS_ACCOUNT_ID>.dkr.ecr.<REGION>.amazonaws.com/deployra/mysql-proxy:latest

# Push
docker push <AWS_ACCOUNT_ID>.dkr.ecr.<REGION>.amazonaws.com/deployra/mysql-proxy:latest
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
image: <AWS_ACCOUNT_ID>.dkr.ecr.<REGION>.amazonaws.com/deployra/mysql-proxy:latest
```

### Step 6: Deploy to Kubernetes

```bash
kubectl apply -f k8s/
```

### Step 7: Verify Deployment

```bash
kubectl get pods -n system-apps -l app=mysql-proxy
kubectl logs -n system-apps -l app=mysql-proxy
```

## Project Structure

```
mysql/
├── main.go
├── Dockerfile
├── go.mod
├── go.sum
├── pkg/
│   ├── config/
│   │   └── config.go
│   ├── kubernetes/
│   │   └── kubernetes.go
│   └── proxy/
│       ├── server.go
│       ├── dns.go
│       └── buffer_pool.go
└── k8s/
    ├── proxy-deployment.yaml
    ├── proxy-service.yaml
    ├── proxy-rbac.yaml
    ├── proxy-networkpolicy.yaml
    └── proxy-pdb.yaml
```

## License

Apache-2.0
