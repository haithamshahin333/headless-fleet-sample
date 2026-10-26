{{/* Names and labels. */}}
{{- define "portal.name" -}}
{{- .Chart.Name | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{- define "portal.fullname" -}}
{{- if contains .Chart.Name .Release.Name -}}
{{- .Release.Name | trunc 63 | trimSuffix "-" -}}
{{- else -}}
{{- printf "%s-%s" .Release.Name .Chart.Name | trunc 63 | trimSuffix "-" -}}
{{- end -}}
{{- end -}}

{{- define "portal.selectorLabels" -}}
app.kubernetes.io/name: {{ include "portal.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end -}}

{{- define "portal.labels" -}}
helm.sh/chart: {{ printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" }}
{{ include "portal.selectorLabels" . }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
{{- end -}}

{{- define "portal.serviceAccountName" -}}
{{- if .Values.serviceAccount.create -}}
{{- default (include "portal.fullname" .) .Values.serviceAccount.name -}}
{{- else -}}
{{- default "default" .Values.serviceAccount.name -}}
{{- end -}}
{{- end -}}

{{- define "portal.image" -}}
{{- printf "%s:%s" .Values.image.repository (default .Chart.AppVersion .Values.image.tag) -}}
{{- end -}}

{{/* The portal URL without a trailing slash: AUTH_URL. */}}
{{- define "portal.url" -}}
{{- trimSuffix "/" .Values.portal.url -}}
{{- end -}}

{{/* The ingress host: portal.url without scheme or port. */}}
{{- define "portal.host" -}}
{{- regexReplaceAll ":[0-9]+$" (urlParse .Values.portal.url).host "" -}}
{{- end -}}

{{- define "portal.tlsSecretName" -}}
{{- default (printf "%s-tls" (include "portal.fullname" .)) .Values.ingress.tls.secretName -}}
{{- end -}}

{{/*
Every required or malformed value, reported together, so one `helm install` shows the
whole list instead of one problem per attempt.
*/}}
{{- define "portal.validate" -}}
{{- $v := .Values -}}
{{- $errs := list -}}
{{- $https := "^https://[^/?#\\s]+/?$" -}}
{{- $local := "^http://(localhost|127\\.0\\.0\\.1)(:[0-9]+)?/?$" -}}
{{- $httpsAny := "^https://[^\\s]+$" -}}
{{- $localAny := "^http://(localhost|127\\.0\\.0\\.1)(:[0-9]+)?(/[^\\s]*)?$" -}}

{{- if not $v.image.repository -}}
{{- $errs = append $errs "image.repository: where you pushed the image built from portal/Dockerfile, e.g. myregistry.azurecr.io/headless-fleet-portal" -}}
{{- end -}}

{{- if not $v.portal.url -}}
{{- $errs = append $errs "portal.url: the URL people open, e.g. https://agents.example.com" -}}
{{- else if not (or (regexMatch $https $v.portal.url) (regexMatch $local $v.portal.url)) -}}
{{- $errs = append $errs (printf "portal.url: %q must be https:// at the root of a host (no path), e.g. https://agents.example.com" $v.portal.url) -}}
{{- end -}}

{{- if not $v.langsmith.apiUrl -}}
{{- $errs = append $errs "langsmith.apiUrl: your LangSmith API, e.g. https://langsmith.example.com/api" -}}
{{- else if not (or (regexMatch $httpsAny $v.langsmith.apiUrl) (regexMatch $localAny $v.langsmith.apiUrl)) -}}
{{- $errs = append $errs (printf "langsmith.apiUrl: %q must be an https:// URL" $v.langsmith.apiUrl) -}}
{{- end -}}

{{- if not $v.oidc.issuer -}}
{{- $errs = append $errs "oidc.issuer: your identity provider's issuer URL, e.g. https://login.microsoftonline.com/<tenant-id>/v2.0" -}}
{{- else if not (or (regexMatch $httpsAny $v.oidc.issuer) (regexMatch $localAny $v.oidc.issuer)) -}}
{{- $errs = append $errs (printf "oidc.issuer: %q must be an https:// URL" $v.oidc.issuer) -}}
{{- end -}}

{{- if not $v.oidc.clientId -}}
{{- $errs = append $errs "oidc.clientId: the portal's client (application) ID in your identity provider" -}}
{{- end -}}

{{- if not $v.oidc.audience -}}
{{- $errs = append $errs "oidc.audience: the same value as LangSmith's FLEET_EXTERNAL_AUTH_OIDC_AUDIENCE" -}}
{{- end -}}

{{- if not $v.oidc.subjectClaim -}}
{{- $errs = append $errs "oidc.subjectClaim: the claim LangSmith maps to a user (oid on Entra ID, sub elsewhere)" -}}
{{- end -}}

{{- if not $v.secrets.existingSecret -}}
{{- $errs = append $errs "secrets.existingSecret: a Secret with keys oidc-client-secret and auth-secret (kubectl create secret generic …, see values.yaml)" -}}
{{- end -}}

{{- if and $v.httpRoute.enabled (not $v.httpRoute.parentRefs) -}}
{{- $errs = append $errs "httpRoute.parentRefs: the Gateway to attach to, e.g. [{ name: my-gateway, namespace: gateway-system }]" -}}
{{- end -}}

{{- if $errs -}}
{{- fail (printf "\n\nThe portal needs %d more value(s). Set them in your values file (section 1 of values.yaml):\n\n  - %s\n" (len $errs) (join "\n  - " $errs)) -}}
{{- end -}}
{{- end -}}
