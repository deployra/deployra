# Deployra Infrastructure - Hetzner Cloud Kubernetes

Terraform configuration for provisioning a Kubernetes cluster on Hetzner Cloud using [kube-hetzner](https://github.com/kube-hetzner/terraform-hcloud-kube-hetzner).

## Prerequisites

- [Terraform](https://www.terraform.io/downloads.html) >= 1.5.0
- [Packer](https://www.packer.io/downloads)
- [Hetzner Cloud API Token](https://docs.hetzner.cloud/#overview-getting-started) (Read & Write)
- SSH key pair

## Quick Start

### 1. Set Hetzner API Token

```bash
export TF_VAR_hcloud_token=your_hetzner_api_token
export HCLOUD_TOKEN=your_hetzner_api_token
```

### 2. Configure SSH Keys

Update `kube.tf` with your SSH key paths:

```hcl
ssh_public_key  = file("~/.ssh/id_ed25519.pub")
ssh_private_key = file("~/.ssh/id_ed25519")
```

### 3. Create MicroOS Snapshots

Download packer template from kube-hetzner and build snapshots:

```bash
curl -sL https://raw.githubusercontent.com/kube-hetzner/terraform-hcloud-kube-hetzner/master/packer-template/hcloud-microos-snapshots.pkr.hcl -o hcloud-microos-snapshots.pkr.hcl
packer init hcloud-microos-snapshots.pkr.hcl
packer build hcloud-microos-snapshots.pkr.hcl
```

### 4. Deploy Cluster

```bash
terraform init
terraform plan
terraform apply
```

### 5. Get Kubeconfig

```bash
terraform output -raw kubeconfig > ~/.kube/config
chmod 600 ~/.kube/config
```

## Cluster Configuration

Default configuration in `kube.tf`:

| Component | Spec |
|-----------|------|
| Control Plane | 1x cx32 (fsn1) |
| Agent Nodes | 2x cpx41 (fsn1) |
| Autoscaler | 0-3x cpx41 |
| Load Balancer | lb11 |
| Ingress | none (uses web-proxy) |

## Post-Deployment Setup

### Create Namespace

```bash
kubectl create namespace system-apps
```

### Create ECR Secret

```bash
kubectl create secret docker-registry ecr-credentials \
  --namespace system-apps \
  --docker-server=<AWS_ACCOUNT_ID>.dkr.ecr.<REGION>.amazonaws.com \
  --docker-username=AWS \
  --docker-password=$(aws ecr get-login-password --region <REGION>)
```

### Deploy Services

```bash
kubectl apply -f ../api/k8s/
kubectl apply -f ../dashboard/k8s/
kubectl apply -f ../services/kubestrator/k8s/
kubectl apply -f ../services/kumonitor/k8s/
kubectl apply -f ../proxies/web/k8s/
kubectl apply -f ../proxies/mysql/k8s/
kubectl apply -f ../proxies/postgresql/k8s/
kubectl apply -f ../proxies/memory/k8s/
```

## Useful Commands

```bash
# Get node resources
kubectl get nodes -o custom-columns="NAME:.metadata.name,CPU:.status.allocatable.cpu,MEMORY:.status.allocatable.memory"

# Get pod resource usage
kubectl top pods -A

# Connect to node
ssh -i ~/.ssh/id_ed25519 root@<node_ip>
```

## Scaling

Modify `count` in nodepool configuration and run `terraform apply`.

## Destroy

```bash
terraform destroy
```

## License

Apache-2.0
