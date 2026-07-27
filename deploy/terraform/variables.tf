variable "namespace" {
  description = "Namespace to install GitLaunch into."
  type        = string
  default     = "gitlaunch"
}

variable "create_namespace" {
  description = "Create the namespace. Set false if it already exists or is managed elsewhere."
  type        = bool
  default     = true
}

variable "release_name" {
  description = "Helm release name."
  type        = string
  default     = "gitlaunch"
}

variable "chart_path" {
  description = "Path to the GitLaunch chart, or a chart reference once one is published."
  type        = string
  default     = "../helm/gitlaunch"
}

variable "public_url" {
  description = "External URL users reach this instance on. OAuth callbacks and emailed links are built from it."
  type        = string

  validation {
    condition     = can(regex("^https?://", var.public_url))
    error_message = "public_url must include a scheme, e.g. https://gitlaunch.acme.com."
  }
}

# --- Required secrets -------------------------------------------------------

variable "mongodb_uri" {
  description = "MongoDB connection string. GitLaunch stores everything here."
  type        = string
  sensitive   = true
}

variable "cookie_secret" {
  description = "Signing secret for session cookies. Generate with: openssl rand -base64 32"
  type        = string
  sensitive   = true
}

variable "encryption_key" {
  description = <<-EOT
    32-byte base64 key encrypting stored credentials at rest. The app refuses to
    boot without it. Losing it strands already-encrypted data — see
    docs/SELF-HOSTING.md before rotating.
  EOT
  type        = string
  sensitive   = true
}

variable "license_key" {
  description = "Self-hosted license. Empty runs unlicensed: existing resources keep working, new ones are blocked."
  type        = string
  sensitive   = true
  default     = ""
}

variable "license_public_key" {
  description = "Overrides the license issuer public key baked into the image. Only needed if you issue your own licenses."
  type        = string
  sensitive   = true
  default     = ""
}

# --- Optional integrations --------------------------------------------------

variable "github_app_id" {
  description = "GitHub App id. Optional — a Jenkins-only install does not need it."
  type        = string
  default     = ""
}

variable "github_app_client_id" {
  type    = string
  default = ""
}

variable "github_app_client_secret" {
  type      = string
  sensitive = true
  default   = ""
}

variable "github_app_webhook_secret" {
  type      = string
  sensitive = true
  default   = ""
}

variable "github_app_private_key" {
  type      = string
  sensitive = true
  default   = ""
}

variable "resend_api_key" {
  description = "Transactional email. Without it, confirmation links are logged rather than sent."
  type        = string
  sensitive   = true
  default     = ""
}

variable "redis_url" {
  description = "Shared feature-flag cache. Strongly recommended above one replica."
  type        = string
  default     = ""
}

variable "email_from" {
  description = "Verified sender, e.g. \"GitLaunch <noreply@acme.com>\"."
  type        = string
  default     = ""
}

# --- Deployment shape -------------------------------------------------------

variable "replica_count" {
  type    = number
  default = 2
}

variable "image_repository" {
  type    = string
  default = "ghcr.io/donedgardo/gitlaunch"
}

variable "image_tag" {
  description = "Image tag. Empty uses the chart's appVersion."
  type        = string
  default     = ""
}

variable "analytics_warehouse" {
  description = "Persist product analytics into MongoDB for the built-in dashboard."
  type        = bool
  default     = true
}

variable "ingress_enabled" {
  type    = bool
  default = true
}

variable "ingress_host" {
  description = "Ingress hostname. Should match public_url's host."
  type        = string
  default     = ""
}

variable "ingress_class_name" {
  description = "IngressClass. Empty uses the cluster default."
  type        = string
  default     = ""
}

variable "ingress_tls" {
  description = "TLS blocks passed through to the Ingress."
  type = list(object({
    secretName = string
    hosts      = list(string)
  }))
  default = []
}

variable "extra_values" {
  description = "Arbitrary chart values merged over the above, for settings this module does not model."
  type        = any
  default     = {}
}

variable "timeout_seconds" {
  description = "How long to wait for the release to become ready."
  type        = number
  default     = 600
}
