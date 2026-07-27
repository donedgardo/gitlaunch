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

{{/*
Fail early on configuration that would otherwise produce a pod that starts and
then misbehaves in ways that are tedious to diagnose.
*/}}
{{- define "gitlaunch.validateConfig" -}}
{{- if not .Values.secrets.existingSecret -}}
  {{- if not .Values.secrets.mongodbUri -}}
    {{- fail "secrets.mongodbUri is required (or set secrets.existingSecret). GitLaunch stores everything in MongoDB." -}}
  {{- end -}}
  {{- if not .Values.secrets.cookieSecret -}}
    {{- fail "secrets.cookieSecret is required (or set secrets.existingSecret). Generate one with: openssl rand -base64 32" -}}
  {{- end -}}
  {{- if not .Values.secrets.encryptionKey -}}
    {{- fail "secrets.encryptionKey is required (or set secrets.existingSecret). It encrypts stored credentials at rest; the app refuses to boot without it. Generate one with: openssl rand -base64 32" -}}
  {{- end -}}
{{- end -}}
{{- if not .Values.config.publicUrl -}}
  {{- fail "config.publicUrl is required — OAuth callbacks and emailed links are built from it." -}}
{{- end -}}
{{- if and (gt (int .Values.replicaCount) 1) (not .Values.config.redisUrl) -}}
  {{- /* Not fatal: flags still work, they just propagate per-replica. */ -}}
{{- end -}}
{{- end -}}
