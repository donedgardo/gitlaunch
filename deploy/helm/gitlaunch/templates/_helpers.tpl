{{/* Chart name, overridable. */}}
{{- define "gitlaunch.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{/* Fully qualified release name, capped at the 63-char label limit. */}}
{{- define "gitlaunch.fullname" -}}
{{- if .Values.fullnameOverride -}}
{{- .Values.fullnameOverride | trunc 63 | trimSuffix "-" -}}
{{- else -}}
{{- $name := default .Chart.Name .Values.nameOverride -}}
{{- if contains $name .Release.Name -}}
{{- .Release.Name | trunc 63 | trimSuffix "-" -}}
{{- else -}}
{{- printf "%s-%s" .Release.Name $name | trunc 63 | trimSuffix "-" -}}
{{- end -}}
{{- end -}}
{{- end -}}

{{- define "gitlaunch.chart" -}}
{{- printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{- define "gitlaunch.labels" -}}
helm.sh/chart: {{ include "gitlaunch.chart" . }}
{{ include "gitlaunch.selectorLabels" . }}
{{- if .Chart.AppVersion }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
{{- end }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
{{- end -}}

{{- define "gitlaunch.selectorLabels" -}}
app.kubernetes.io/name: {{ include "gitlaunch.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end -}}

{{- define "gitlaunch.serviceAccountName" -}}
{{- if .Values.serviceAccount.create -}}
{{- default (include "gitlaunch.fullname" .) .Values.serviceAccount.name -}}
{{- else -}}
{{- default "default" .Values.serviceAccount.name -}}
{{- end -}}
{{- end -}}

{{/*
The Secret the pod reads from: either one the operator manages externally, or
the one this chart renders.
*/}}
{{- define "gitlaunch.secretName" -}}
{{- if .Values.secrets.existingSecret -}}
{{- .Values.secrets.existingSecret -}}
{{- else -}}
{{- include "gitlaunch.fullname" . -}}
{{- end -}}
{{- end -}}

{{/* Name of the Secret holding the bundled MongoDB credentials and URI. */}}
{{- define "gitlaunch.mongodb.secretName" -}}
{{- printf "%s-mongodb" (include "gitlaunch.fullname" .) -}}
{{- end -}}

{{- define "gitlaunch.mongodb.fullname" -}}
{{- printf "%s-mongodb" (include "gitlaunch.fullname" .) -}}
{{- end -}}

{{/*
MongoDB gets its OWN app.kubernetes.io/name, not the app's name plus a
component label.

Label selectors match on subset: a Service or Deployment selecting
{name: gitlaunch, instance: X} also matches a pod carrying those two labels
*plus* component=mongodb. Reusing the app's selectorLabels here put the MongoDB
pod into the application Service's endpoints, so requests to the app were load
balanced onto the database. A distinct name is what actually separates them.
*/}}
{{- define "gitlaunch.mongodb.selectorLabels" -}}
app.kubernetes.io/name: {{ printf "%s-mongodb" (include "gitlaunch.name" .) }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end -}}

{{- define "gitlaunch.mongodb.labels" -}}
helm.sh/chart: {{ include "gitlaunch.chart" . }}
{{ include "gitlaunch.mongodb.selectorLabels" . }}
{{- if .Chart.AppVersion }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
{{- end }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
app.kubernetes.io/component: mongodb
{{- end -}}

{{/*
Read one key out of a Secret that already exists in the cluster, or "" if the
Secret (or the key) is not there yet. This is what makes generated values
survive `helm upgrade` — without it every upgrade would mint a new encryption
key and strand every credential already encrypted in MongoDB.
*/}}
{{- define "gitlaunch.existingSecretValue" -}}
{{- $found := lookup "v1" "Secret" .namespace .name -}}
{{- if $found -}}
{{- $encoded := get ($found.data | default dict) .key | default "" -}}
{{- if $encoded -}}{{- $encoded | b64dec -}}{{- end -}}
{{- end -}}
{{- end -}}

{{/*
Session signing secret: an explicit value wins, else whatever is already
installed, else a fresh one.
*/}}
{{- define "gitlaunch.cookieSecret" -}}
{{- if .Values.secrets.cookieSecret -}}
{{- .Values.secrets.cookieSecret -}}
{{- else -}}
{{- $current := include "gitlaunch.existingSecretValue" (dict "namespace" .Release.Namespace "name" (include "gitlaunch.fullname" .) "key" "COOKIE_SECRET_SIGNATURE") -}}
{{- $current | default (randAlphaNum 48) -}}
{{- end -}}
{{- end -}}

{{/*
Encryption key for credentials stored at rest. The app requires exactly 32
bytes, so generate 32 random characters and base64 them — never a raw
`randAlphaNum 32`, which would decode to the wrong length.
*/}}
{{- define "gitlaunch.encryptionKey" -}}
{{- if .Values.secrets.encryptionKey -}}
{{- .Values.secrets.encryptionKey -}}
{{- else -}}
{{- $current := include "gitlaunch.existingSecretValue" (dict "namespace" .Release.Namespace "name" (include "gitlaunch.fullname" .) "key" "ENCRYPTION_KEY") -}}
{{- $current | default (randAlphaNum 32 | b64enc) -}}
{{- end -}}
{{- end -}}

{{/*
Root password for the bundled MongoDB.

NOTE: call this exactly once per rendered template and assign it to a variable.
Each invocation without an existing Secret produces a NEW random value, so
using it twice in one file would write one password and connect with another.
*/}}
{{- define "gitlaunch.mongodb.password" -}}
{{- if .Values.mongodb.auth.password -}}
{{- .Values.mongodb.auth.password -}}
{{- else -}}
{{- $current := include "gitlaunch.existingSecretValue" (dict "namespace" .Release.Namespace "name" (include "gitlaunch.mongodb.secretName" .) "key" "MONGO_INITDB_ROOT_PASSWORD") -}}
{{- $current | default (randAlphaNum 24) -}}
{{- end -}}
{{- end -}}

{{/*
Fail early on configuration that would otherwise produce a pod that starts and
then misbehaves in ways that are tedious to diagnose.
*/}}
{{- define "gitlaunch.validateConfig" -}}
{{- if not .Values.secrets.existingSecret -}}
  {{- if and (not .Values.secrets.mongodbUri) (not .Values.mongodb.enabled) -}}
    {{- fail "secrets.mongodbUri is required (or set mongodb.enabled=true to run a bundled one, or secrets.existingSecret). GitLaunch stores everything in MongoDB." -}}
  {{- end -}}
  {{- if and (not .Values.secrets.cookieSecret) (not .Values.secrets.autoGenerate) -}}
    {{- fail "secrets.cookieSecret is required when secrets.autoGenerate is false (or set secrets.existingSecret). Generate one with: openssl rand -base64 32" -}}
  {{- end -}}
  {{- if and (not .Values.secrets.encryptionKey) (not .Values.secrets.autoGenerate) -}}
    {{- fail "secrets.encryptionKey is required when secrets.autoGenerate is false (or set secrets.existingSecret). It encrypts stored credentials at rest; the app refuses to boot without it. Generate one with: openssl rand -base64 32" -}}
  {{- end -}}
{{- end -}}
{{- if not .Values.config.publicUrl -}}
  {{- fail "config.publicUrl is required — OAuth callbacks and emailed links are built from it." -}}
{{- end -}}
{{- if and .Values.config.googleClientId (not .Values.secrets.googleClientSecret) -}}
  {{- fail "secrets.googleClientSecret is required when config.googleClientId is set. Sign-in with Google is optional — leave both empty to hide the button." -}}
{{- end -}}
{{- if and .Values.secrets.resendApiKey (not .Values.config.emailFrom) -}}
  {{- fail "config.emailFrom is required when secrets.resendApiKey is set, e.g. \"GitLaunch <noreply@acme.com>\"." -}}
{{- end -}}
{{- if and .Values.mongodb.enabled .Values.secrets.mongodbUri -}}
  {{- fail "Set either mongodb.enabled=true (bundled) or secrets.mongodbUri (external), not both." -}}
{{- end -}}
{{- if and .Values.mongodb.enabled (gt (int .Values.replicaCount) 1) (not .Values.mongodb.persistence.enabled) -}}
  {{- fail "The bundled MongoDB is a single node with no persistence — do not point multiple GitLaunch replicas at it. Enable mongodb.persistence or use an external MongoDB." -}}
{{- end -}}
{{- end -}}
