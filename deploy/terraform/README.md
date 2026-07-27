# Terraform install (optional)

Wraps the GitLaunch Helm chart for teams who provision through a Terraform stack
rather than running `helm` directly. Using this is entirely optional — the chart
works on its own.

Cloud-neutral by design: it provisions **no** database, DNS or certificates.
Those are cloud-specific and usually already covered by your own modules. This
needs a cluster and a MongoDB connection string.

## Usage

```hcl
provider "kubernetes" {
  config_path = "~/.kube/config"
}

provider "helm" {
  kubernetes {
    config_path = "~/.kube/config"
  }
}

module "gitlaunch" {
  source = "./deploy/terraform"

  public_url     = "https://gitlaunch.acme.com"
  ingress_host   = "gitlaunch.acme.com"

  mongodb_uri    = var.mongodb_uri
  cookie_secret  = var.cookie_secret
  encryption_key = var.encryption_key
  license_key    = var.gitlaunch_license

  redis_url      = "redis://redis.gitlaunch.svc.cluster.local:6379"

  ingress_tls = [{
    secretName = "gitlaunch-tls"
    hosts      = ["gitlaunch.acme.com"]
  }]
}
```

```bash
terraform init && terraform apply
```

## Notes

- Secrets are written to a Kubernetes Secret managed by this module, and the
  chart is pointed at it via `existingSecret`. They never travel through Helm
  values, so they do not end up in the Helm release stored in the cluster.
- They **do** end up in Terraform state. Use a remote backend with encryption
  and restricted access, or set `license_key` and friends from a secret manager
  data source rather than variables.
- The release is `atomic` with `cleanup_on_fail`, so a failed upgrade rolls back
  rather than leaving a half-applied release.
- `extra_values` takes any chart value this module does not model, merged over
  the generated ones.
