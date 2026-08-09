# Self-Hosting GitLaunch

GitLaunch can run inside your own infrastructure, so deployment data, feature
flags and A/B test assignments never leave your network. This is the Enterprise
distribution: you run the software, we license it.

> **Status: partially available.** CI publishes
> `ghcr.io/donedgardo/gitlaunch` on every push to `main` and on every `v*` tag,
> so the image a customer needs now exists. There is still no published chart
> repository — the chart installs from a local path — and the image is not
> signed.

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

### Evaluation: one command, nothing to prepare

`mongodb.enabled=true` runs an in-cluster MongoDB, and the session and
encryption secrets are generated on first install:

```bash
helm install gitlaunch ./deploy/helm/gitlaunch \
  --namespace gitlaunch --create-namespace \
  --set config.publicUrl=https://gitlaunch.acme.com \
  --set mongodb.enabled=true \
  --set ingress.enabled=true \
  --set ingress.hosts[0].host=gitlaunch.acme.com
```

The bundled MongoDB is a **single node with no replica set, no failover and no
backups**. Use it for evaluation, demos and CI. For anything you care about,
point `secrets.mongodbUri` at a managed or HA MongoDB instead.

### Production: your database, your secrets

```bash
helm install gitlaunch ./deploy/helm/gitlaunch \
  --namespace gitlaunch --create-namespace \
  --set config.publicUrl=https://gitlaunch.acme.com \
  --set secrets.mongodbUri='mongodb://user:pass@mongo:27017/gitlaunch' \
  --set secrets.cookieSecret="$(openssl rand -base64 32)" \
  --set secrets.encryptionKey="$(openssl rand -base64 32)" \
  --set secrets.licenseKey='<the license key issued to you>' \
  --set ingress.enabled=true \
  --set ingress.hosts[0].host=gitlaunch.acme.com
```

The chart refuses to render on configuration that would produce a pod that
starts and then misbehaves — a missing `publicUrl` or database, a Google client
id with no secret, a Resend key with no sender address, or several replicas
pointed at an ephemeral bundled database.

### Generated secrets

When `secrets.cookieSecret` and `secrets.encryptionKey` are left empty and
`secrets.autoGenerate` is true (the default), the chart generates them on first
install and reads them back out of the live Secret on every later upgrade, so
they stay stable. The bundled MongoDB's root password works the same way.

Two consequences are worth knowing before you rely on this:

- **`helm template` cannot read the cluster.** It prints new random values every
  time. See [GitOps installs](#gitops-installs) below — this is a real hazard,
  not a footnote, and the chart now has a switch for it.
- **`helm uninstall` deletes the Secret.** Back up `encryptionKey` before tearing
  an environment down if its data is meant to outlive it.

### GitOps installs

If a reconciler (Argo CD, Flux) or any `helm template | kubectl apply` pipeline
manages this chart, **turn generation off**:

```yaml
secrets:
  autoGenerate: false
  existingSecret: gitlaunch-app-secrets
mongodb:
  auth:
    existingSecret: gitlaunch-mongodb-secrets
```

The read-back described above is a Helm `lookup`, which returns nothing when
there is no cluster to look at. Left on, every sync mints fresh credentials:

- a new `encryptionKey`, stranding every credential already encrypted under the
  old one — Jenkins tokens, provider secrets;
- a new MongoDB root password, which the database will reject, because
  `MONGO_INITDB_ROOT_PASSWORD` is only honoured while initialising an _empty_
  data directory. The result is an application that cannot authenticate against
  a database nobody can log into either.

`autoGenerate: false` is an interlock rather than a preference: with it false the
chart refuses to render unless both `existingSecret` values are supplied, so no
path is left that can invent a credential mid-sync. You can check that your
values are safe before a reconciler ever touches them —

```bash
# renders must be byte-identical; if they are not, generation is still reachable
diff <(helm template gitlaunch ./gitlaunch -f my-values.yaml) \
     <(helm template gitlaunch ./gitlaunch -f my-values.yaml)
```

Supplying those Secrets is your choice of Sealed Secrets, External Secrets
Operator, the Secrets Store CSI driver, or a one-off `kubectl create secret`.
Note that Argo CD deliberately does not do this itself and
[recommends managing secrets on the destination cluster](https://argo-cd.readthedocs.io/en/stable/operator-manual/secret-management/),
cautioning against plugins that inject secrets during manifest generation —
Argo caches rendered manifests in plaintext. `deploy/envs` in this repo is a
worked example using Sealed Secrets.

Migrating an already-running install is an ordering problem: copy the live
generated values into the external Secrets **before** the first sync with
`autoGenerate: false`, because that sync is when Helm prunes the Secrets it used
to own. Give the new Secrets different names from the chart's
(`{release}` and `{release}-mongodb`) so the two never contend for one object.

## Optional components

Nothing below is required. Each one stays off until you configure it, and the
UI hides what is not available rather than offering a button that leads nowhere.

| Component           | Turn it on with                                                                   | When it is off                                                         |
| ------------------- | --------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| GitHub App          | `secrets.githubAppId` + `githubAppClientId` + `...ClientSecret` + `...PrivateKey` | No GitHub integration; a Jenkins-only install is fully supported       |
| Sign in with Google | `config.googleClientId` + `secrets.googleClientSecret`                            | The Google button is hidden on login and signup                        |
| Transactional email | `secrets.resendApiKey` + `config.emailFrom`                                       | Confirmation links are logged, not sent; OAuth sign-in still works     |
| Shared flag cache   | `config.redisUrl`                                                                 | Per-replica in-memory cache; flag changes apply per pod, not fleetwide |
| Product analytics   | `config.analyticsWarehouse=true`                                                  | Events are dropped instead of stored                                   |
| Bundled MongoDB     | `mongodb.enabled=true`                                                            | You supply `secrets.mongodbUri`                                        |
| Ingress             | `ingress.enabled=true`                                                            | Reach the service via port-forward or your own routing                 |
| Autoscaling         | `autoscaling.enabled=true`                                                        | Fixed `replicaCount`                                                   |

The GitHub App credentials are all-or-nothing: supplying some but not all is
rejected, because a half-configured integration looks present and then fails on
first use.

Billing (Stripe) is **not** exposed by this chart. Self-hosted instances are
entitled by their license key, not by a subscription, so the billing routes stay
off regardless of what is in the environment.

### Secrets in production

Passing secrets on the command line puts them in your shell history and in the
Helm release. For real installs, manage the Secret yourself — Vault, Sealed
Secrets, SOPS, External Secrets — and point the chart at it:

```bash
--set secrets.existingSecret=gitlaunch-secrets
```

The Secret must carry the same keys the chart would have written; see
`deploy/helm/gitlaunch/templates/secret.yaml` for the exact list.

`secrets.existingSecret` covers the application's Secret only. If you also run
the bundled MongoDB, set `mongodb.auth.existingSecret` — that Secret needs
`MONGO_INITDB_ROOT_USERNAME`, `MONGO_INITDB_ROOT_PASSWORD` and a `MONGODB_URI`
consistent with them.

**`encryptionKey` is not rotatable in place by re-installing.** It decrypts
credentials already stored in MongoDB (such as Jenkins API tokens). Losing it
strands that data. To rotate, use the keyring form (`ENCRYPTION_KEYS` +
`ENCRYPTION_PRIMARY_KEY_ID`) documented in `sample.env`, which keeps old keys
available for decryption while new writes use the primary.

---

## Licensing

Your instance is entitled by the signed license key issued with your
subscription. It is an Ed25519-signed token that this build verifies against the
issuer key compiled into the image. **Nothing phones home** — verification is
entirely local, which is what lets GitLaunch run in an air-gapped datacentre.

What your license governs:

- Repositories, services and environments are **unmetered**. You bought the
  software, not a usage tier.
- **Seats are metered** at the number your license sold.

### When a license is missing or expired

The instance keeps serving everything that already exists, and blocks the
creation of new services, repositories, users and environments. It does **not**
go read-only and does **not** stop deployments.

This is deliberate: a lapsed renewal must never take your production pipeline
down. A rejected license is logged at boot as
`GitLaunch license was not honoured: <reason>` and the instance starts anyway —
you can fix a license from a running dashboard, not from a crash loop.

To apply a renewed license, update `GITLAUNCH_LICENSE_KEY` in your Secret and
restart the deployment.

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
- **Image signing and chart publishing.** The image is published to
  `ghcr.io/donedgardo/gitlaunch`, but it is not signed (no cosign/provenance
  attestation) and there is no public chart repository — the chart still
  installs from a local path. An air-gapped buyer can mirror the image today;
  a buyer who requires supply-chain attestation cannot yet verify it.
- **Backup/restore runbook.** MongoDB holds everything, but there is no
  documented, tested restore procedure.
- **Audit log.** No tamper-evident record of who changed a flag or triggered a
  deploy.
