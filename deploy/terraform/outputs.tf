output "namespace" {
  description = "Namespace GitLaunch was installed into."
  value       = var.namespace
}

output "release_name" {
  description = "Helm release name."
  value       = helm_release.gitlaunch.name
}

output "chart_version" {
  description = "Chart version that was applied."
  value       = helm_release.gitlaunch.version
}

output "app_version" {
  description = "Application version running."
  value       = helm_release.gitlaunch.metadata[0].app_version
}

output "public_url" {
  description = "URL this instance believes it is reachable on."
  value       = var.public_url
}

output "licensed" {
  description = "Whether a license key was supplied. False means new resources are blocked."
  # Derived from a sensitive variable, so Terraform taints it by default. Only
  # the emptiness of the key is exposed, never the key, so unmark it explicitly
  # rather than hiding a boolean an operator needs to see.
  value = nonsensitive(var.license_key != "")
}
