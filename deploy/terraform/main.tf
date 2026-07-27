# Installs self-hosted GitLaunch into an existing Kubernetes cluster.
#
# Deliberately cloud-neutral: it provisions no database, DNS or certificates,
# because those are cloud-specific and usually already governed by your own
# modules and policies. Give it a cluster and a MongoDB connection string.

terraform {
  required_version = ">= 1.3.0"

  required_providers {
    helm = {
      source  = "hashicorp/helm"
      version = ">= 2.12.0"
    }
    kubernetes = {
      source  = "hashicorp/kubernetes"
      version = ">= 2.25.0"
    }
  }
}

locals {
  # Secrets go into a Kubernetes Secret managed here rather than into Helm
  # values, so they never land in the Helm release stored in the cluster.
  secret_name = "${var.release_name}-secrets"
}

resource "kubernetes_namespace_v1" "gitlaunch" {
  count = var.create_namespace ? 1 : 0

  metadata {
    name = var.namespace
  }
}

resource "kubernetes_secret_v1" "gitlaunch" {
  metadata {
    name      = local.secret_name
    namespace = var.namespace
  }

  # Only non-empty values are sent, so optional integrations stay unset rather
  # than being written as empty strings the app would treat as configured.
  data = {
    for k, v in {
      MONGODB_URI             = var.mongodb_uri
      COOKIE_SECRET_SIGNATURE = var.cookie_secret
      ENCRYPTION_KEY          = var.encryption_key
      GITLAUNCH_LICENSE_KEY   = var.license_key
      GH_APP_ID               = var.github_app_id
      GH_APP_CLIENT_ID        = var.github_app_client_id
      GH_APP_CLIENT_SECRET    = var.github_app_client_secret
      GH_APP_WEBHOOK_SECRET   = var.github_app_webhook_secret
      GH_APP_PRIVATE_KEY      = var.github_app_private_key
      RESEND_API_KEY          = var.resend_api_key
    } : k => v if v != ""
  }

  type = "Opaque"

  depends_on = [kubernetes_namespace_v1.gitlaunch]
}

resource "helm_release" "gitlaunch" {
  name      = var.release_name
  chart     = var.chart_path
  namespace = var.namespace

  # Never leave a half-applied release behind on a failed upgrade.
  atomic          = true
  cleanup_on_fail = true
  wait            = true
  timeout         = var.timeout_seconds

  values = [yamlencode(merge({
    replicaCount = var.replica_count

    image = {
      repository = var.image_repository
      tag        = var.image_tag
    }

    config = {
      publicUrl          = var.public_url
      analyticsWarehouse = var.analytics_warehouse
      redisUrl           = var.redis_url
      emailFrom          = var.email_from
    }

    secrets = {
      # The Secret above is the source of truth; the chart renders none itself.
      existingSecret = kubernetes_secret_v1.gitlaunch.metadata[0].name
    }

    ingress = {
      enabled   = var.ingress_enabled
      className = var.ingress_class_name
      hosts = [{
        host  = var.ingress_host
        paths = [{ path = "/", pathType = "Prefix" }]
      }]
      tls = var.ingress_tls
    }
  }, var.extra_values))]

  depends_on = [kubernetes_secret_v1.gitlaunch]
}
