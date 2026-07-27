# Self-Hosting GitLaunch

GitLaunch can run inside your own infrastructure, so deployment data, feature
flags and A/B test assignments never leave your network. This is the Enterprise
distribution: you run the software, we license it.

Everything here targets **any conformant Kubernetes** — managed (EKS/GKE/AKS),
self-managed (kubeadm, RKE2), lightweight (k3s, MicroK8s) or air-gapped. The
chart creates no cloud-specific resources.

---

## What you need

| Requirement              | Notes                                                          |
| ------------------------ | -------------------------------------------------------------- |
| Kubernetes ≥ 1.23        | Or any distribution that speaks the same API                   |
| MongoDB                  | The only datastore. Managed (Atlas, DocumentDB) or in-cluster  |
| A hostname + TLS         | GitLaunch issues OAuth callbacks and signed cookies against it |
| A license key            | Issued with your subscription — see [Licensing](#licensing)    |
| Redis _(optional)_       | Shares the feature-flag cache across replicas                  |
| SMTP/Resend _(optional)_ | Only needed for email/password signup confirmations            |

---

## Install

```bash
helm install gitlaunch ./deploy/helm/gitlaunch \
  --namespace gitlaunch --create-namespace \
  --set config.publicUrl=https://gitlaunch.acme.com \
  --set secrets.mongodbUri='mongodb://user:pass@mongo:27017/gitlaunch' \
  --set secrets.cookieSecret="$(openssl rand -base64 32)" \
  --set secrets.encryptionKey="$(openssl rand -base64 32)" \
  --set secrets.licenseKey='<your license key>' \
  --set ingress.enabled=true \
  --set ingress.hosts[0].host=gitlaunch.acme.com
```

The chart refuses to render if `mongodbUri`, `cookieSecret`, `encryptionKey` or
`publicUrl` are missing, rather than starting a pod that fails in a way that is
tedious to diagnose.

### Secrets in production

Passing secrets on the command line puts them in your shell history and in the
Helm release. For real installs, manage the Secret yourself — Vault, Sealed
Secrets, SOPS, External Secrets — and point the chart at it:

```bash
--set secrets.existingSecret=gitlaunch-secrets
```

The Secret must carry the same keys the chart would have written; see
`deploy/helm/gitlaunch/templates/secret.yaml` for the exact list.

**`encryptionKey` is not rotatable in place by re-installing.** It decrypts
credentials already stored in MongoDB (such as Jenkins API tokens). Losing it
strands that data. To rotate, use the keyring form (`ENCRYPTION_KEYS` +
`ENCRYPTION_PRIMARY_KEY_ID`) documented in the main README, which keeps old keys
available for decryption while new writes use the primary.

---

## Licensing

A self-hosted instance is entitled by a signed license key, not by Stripe. The
key is an Ed25519-signed token: the image ships the _public_ key, so an instance
can verify a license but cannot mint one. **Nothing phones home** — verification
is entirely local, which is what lets GitLaunch run in an air-gapped
datacentre.

Setting `config.selfHosted: true` (the chart default) changes behaviour:

- Per-resource SaaS tier limits stop applying. Repositories, services and
  environments are unmetered — you bought the software, not a tier.
- **Seats are still metered**, at the number your license sold.
- Trial countdowns, payment-failure warnings and read-only downgrades never
  appear. There is no Stripe in the loop.

### When a license is missing or expired

The instance keeps serving everything that already exists, and blocks the
creation of new services, repositories, users and environments. It does **not**
go read-only and does **not** stop deployments.

This is deliberate. A licensing disagreement must never take a customer's
production pipeline down, and an install that crash-loops on expiry is an outage
we inflicted on someone who paid us. A bad license is logged at boot and the
instance starts anyway — an operator can fix a license from a running dashboard,
but not from a crash loop.

---

## Operational notes

### Probes

The chart wires two different endpoints, and the distinction matters:

- **`/health/live`** (liveness) touches no dependency. A liveness probe pointed
  at the database would restart every replica during a Mongo blip, converting a
  recoverable outage into a crash loop that also destroys the evidence.
- **`/health`** (readiness) does check MongoDB, so replicas leave the load
  balancer while the database is unreachable and rejoin when it returns.

### Replicas and feature flags

With more than one replica, set `config.redisUrl`. Without it each pod keeps its
own in-memory flag cache, so a flag change reaches pods as their individual
caches expire rather than fleet-wide at once. Correct, but not instant — which
is usually not what you want from a kill switch.

Note the app only loads the Redis client when `REDIS_URL` is set, and `ioredis`
must be present in the image for that path.

### Pod security

The chart runs as non-root (UID 1001, matching the image) with a read-only root
filesystem, no privilege escalation and all capabilities dropped.

**OpenShift:** its restricted SCC assigns an arbitrary UID per namespace and
rejects a hardcoded `runAsUser`. Set `podSecurityContext.runAsUser` and
`fsGroup` to `null` and let the platform assign them.

### Air-gapped installs

Mirror the image to your internal registry and set `image.repository` plus
`imagePullSecrets`. Nothing in the chart reaches the public internet at install
time, and license verification is local. Outbound access is only needed for the
integrations you actually use (GitHub, Jenkins, Resend).

### Upgrades

```bash
helm upgrade gitlaunch ./deploy/helm/gitlaunch --reuse-values --set image.tag=1.1.0
```

Database indexes are created at boot, so a rolling upgrade needs no migration
step. Config and Secret checksums are stamped on the pod template, so a change
to either rolls the pods rather than leaving replicas on stale values.

---

## Terraform

Optional, for teams who provision through a Terraform stack rather than running
`helm` directly. `deploy/terraform/` wraps the chart with the `helm` provider so
an install is one `terraform apply`. See its README.

Modules for the _supporting_ resources (Atlas clusters, DocumentDB, DNS,
certificates) are deliberately not included — those are cloud-specific and
usually already governed by your own modules and policies. The chart only needs
a MongoDB connection string, wherever it comes from.

---

## Known gaps

Honest list of what a self-hosted enterprise buyer will ask for that is not
built yet:

- **SSO/SAML/OIDC.** Sign-in today is GitHub OAuth, Google OAuth or
  email/password. There is no SAML or generic OIDC, and no SCIM provisioning.
- **Single-org mode.** The data model is multi-tenant (accounts). A self-hosted
  install still creates accounts, and nothing yet pins an instance to exactly
  one organisation.
- **Air-gapped image publishing.** No official signed image or public chart
  repository is published yet; the chart currently installs from a local path.
- **Backup/restore runbook.** MongoDB holds everything, but there is no
  documented, tested restore procedure.
- **Audit log.** No tamper-evident record of who changed a flag or triggered a
  deploy.
