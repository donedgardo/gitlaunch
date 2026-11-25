# Our own environments, as a GitOps config repo

Desired state for the GitLaunch instances we run ourselves. One directory per
environment, one `values.yaml` each, applied against the chart in
`deploy/helm/gitlaunch`.

This exists so we can dogfood the GitOps model we plan to support before we ask
a customer to. That design has GitLaunch write image bumps into a config
repo that a reconciler pulls. This directory is that config repo — for us, it
happens to live in the same repository as the app source.

| Environment | Namespace         | URL                             | Values                                     |
| ----------- | ----------------- | ------------------------------- | ------------------------------------------ |
| `local`     | `gitlaunch-local` | http://gitlaunch.local          | [`local/values.yaml`](local/values.yaml)   |
| `onprem`    | `onprem`          | http://onprem.localtest.me:8080 | [`onprem/values.yaml`](onprem/values.yaml) |

Both run on the local kind cluster `lab` (`kubectl config use-context kind-lab`).
`local` is our own instance; `onprem` is the self-hosted demo — the thing a
customer would install.

## Applying

Argo CD reconciles both environments from git — see
[`deploy/argocd`](../argocd/README.md). Nothing below is required for a
deploy to happen; it is the same state, applied by hand.

```bash
deploy/envs/apply.sh local
deploy/envs/apply.sh onprem
```

`apply.sh` applies the environment's sealed secrets and then runs
`helm upgrade --install` against the committed values — the same two steps, in
the same order, that the Argo `Application` expresses declaratively. It is
useful for a fast local loop and for standing an environment up before Argo
exists. It is no longer the thing that keeps the cluster equal to the repo:
`selfHeal: true` is. Run `helm upgrade --set` behind Argo's back and it will be
reverted, which is the point.

### Reporting back to GitLaunch

These deploys report through the same API our own CI already uses —
`PATCH /api/v1/services/:serviceId/builds/:buildId/deploy/:env`, the endpoint
`.github/workflows/deploy.yml` calls for the hosted instance and the one
`deploymentSetupGuide.hbs` hands to customers. Nothing new was invented here;
the k8s environments were simply the ones not yet talking to it.

```bash
export GITLAUNCH_SERVICE_ID=<service id>
export GITLAUNCH_API_KEY=<key with deployments:write>
deploy/envs/apply.sh local
```

`buildId` is the app source commit, recovered from the image tag — which only
works because the tag is `sha-<commit>`. Immutable tags buy traceability here,
not just rollback.

Unset credentials mean no reporting rather than a failure, and a reporting
error warns without failing the deploy: applying an environment must not depend
on a running GitLaunch. Set `GITLAUNCH_API_URL` to report to somewhere other
than `https://gitlaunch.dev` — pointing `local` at itself is the tightest
dogfooding loop available.

The environment name sent is the directory name (`local`, `onprem`), so the
Service's environments in GitLaunch have to match, or override with
`GITLAUNCH_ENVIRONMENT`.

## The release image

Both environments run `ghcr.io/donedgardo/gitlaunch` — the image
`.github/workflows/ci.yml` publishes on every push to `main` and every `v*` tag.
That is the same artifact a self-hosted customer installs, which is the point:
they used to run a bare `gitlaunch`, a name nothing outside this laptop can
resolve, so neither environment could have been running the thing we ship. It
mattered most for `onprem`, whose entire job is to be the customer's install.

The package inherits `private` from the repository, so pulling it needs a
credential — even in our own cluster. GHCR knows which repository the package
belongs to, and therefore who may pull it, from the
`org.opencontainers.image.source` label CI stamps on the image; the package is
called `gitlaunch` and the repository `launchpad`, so nothing else links them.
With that link in place a repository collaborator's token is enough, and the
token needs only `read:packages`:

Both environments already have one sealed. To rotate it, or to seal one for a new
environment:

```bash
# Create a token at https://github.com/settings/tokens with read:packages, then:
deploy/envs/seal.sh registry local
deploy/envs/seal.sh registry onprem   # paste the token, ctrl-d

deploy/envs/seal.sh verify local      # registry.sealed.yaml listed OK
```

The result is ciphertext committed under `secrets/`, applied by Argo like the
other two — a pull credential is a secret with the same lifecycle as the rest,
not a `kubectl create secret` someone has to remember. `read:packages` and not
`write:packages`: a cluster only ever pulls, and a token that could push would
let anything able to read that Secret overwrite the release image.

Without a credential an environment can still run a tag already sitting in the
kind node's image store, because `pullPolicy` is `IfNotPresent` rather than
`Always` — which is what [`build-image.sh`](build-image.sh) produces, and what
kept these environments servable while the credential was still missing.

### Two tag widths

Both mean `sha-<commit>`, and the width says who built it:

| Tag              | Built by                            | Pulled?                    |
| ---------------- | ----------------------------------- | -------------------------- |
| `sha-<40 chars>` | CI, from a commit that passed tests | yes, on first use          |
| `sha-<7 chars>`  | `build-image.sh`, on this laptop    | no — side-loaded into kind |

They cannot collide, so `docker images` says plainly which one an environment is
on, and `apply.sh` recovers the build id from either (`git rev-parse` expands
both). `build-image.sh` never pushes: publishing under our name is CI's job.

## The promotion contract

`image.tag` in each values file is the field a promotion rewrites. It is the
whole interface between GitLaunch and this directory. In the terms of the
design doc, wiring this repo up as a `GitOpsDeployment` would read:

```ts
{
  provider: "gitops",
  configRepositoryId: <this repo>,
  environmentPaths: {
    local:  "deploy/envs/local/values.yaml",
    onprem: "deploy/envs/onprem/values.yaml",
  },
  imagePath: "image.tag",
  mergeStrategy: "pull-request",
  reconciler: "argocd",
  appName: "gitlaunch",
}
```

Two things follow from that, and both are reasons to keep these files
hand-friendly:

- **Comments must survive a promotion.** Every heading and caveat in these
  files is human-written. The design doc calls for editing YAML through the
  `yaml` package's Document API rather than a `js-yaml` load/dump round trip
  precisely so a one-line image bump stays a one-line diff. These files are the
  first real test of that.
- **The tag must be immutable.** `image.tag` is `sha-<commit>` — published by CI
  under the full commit, or built by [`build-image.sh`](build-image.sh), which
  stamps the revision as an OCI label and refuses to rebuild a tag that already
  exists. This is what makes rollback real: a moving tag like `latest` or the
  `local`/`config` tags these environments started on would let a revert change
  the file and nothing else — risk 3 in the design doc. The `chart` job in CI
  asserts it, along with the registry and the pull secret, so an environment
  cannot quietly drift back.

Both environments run the same tag. They differ only in the config below it,
which is what makes promoting one artifact between them meaningful.

## Rolling back

Rollback is `git revert` plus an apply. There is no separate mechanism, and
that is the point — the thing that shipped and the thing you roll back to are
both commits.

```bash
git revert <the commit that changed deploy/envs/<env>/values.yaml>
deploy/envs/apply.sh <env>
```

This works for an image bump and for any other config in the file — replica
count, ingress host, analytics settings — because they are all versioned in the
same commit. That is the argument the design doc makes for preferring a revert
over `helm rollback`, which restores only what the chart itself rendered and
leaves externally-managed secrets at whatever the store currently holds.

Two things it does **not** cover, both true of any rollback mechanism:
database migrations that already ran, and events already consumed.

### Drill

Run against `local` on the kind cluster, reading the running image back out of
the cluster at each step:

| Step                                      | Running image           | Helm revision |
| ----------------------------------------- | ----------------------- | ------------- |
| baseline                                  | `gitlaunch:sha-aa23f53` | 3             |
| commit `e3da5aa` bumps `image.tag`, apply | `gitlaunch:sha-ca6a3be` | 4             |
| `git revert e3da5aa`, apply               | `gitlaunch:sha-aa23f53` | 5             |

Both applies rolled the pods, and the ingress answered 200 throughout. The
revert was a one-line diff — every comment in the values file survived it,
which is the property a generated promotion PR has to preserve to stay
reviewable.

Note what this does and does not establish. The two images have identical
contents, because the only commit between them touched files the Dockerfile
never copies. The drill proves the mechanism — a revert moves the running
reference back and restarts the workload — not that the builds differ. Proving
that end of it needs an observable build identity in the app itself, which is
gap 3 below.

## Secrets

Secrets are committed, encrypted, in `<env>/secrets/`, and versioned exactly
like everything else in this directory.

That sentence used to read the opposite way. The chart generates `cookieSecret`,
`encryptionKey` and the bundled MongoDB password on first install and reads them
back from the live Secret on every upgrade — which works under `helm upgrade`
and breaks under anything that renders before it applies. The read-back is a
Helm `lookup`, `helm template` cannot see a cluster, so a reconciler would mint
a **new encryption key on every sync** and strand every credential already
encrypted under the old one. The same hazard applied to the MongoDB password,
with a sharper edge: `MONGO_INITDB_ROOT_PASSWORD` is only honoured while
initialising an empty data directory, so a regenerated password locks you out of
a database that already has data.

You can watch the old behaviour:

```bash
# two identical renders, eight different secret bytes
diff <(helm template gitlaunch deploy/helm/gitlaunch --set config.publicUrl=http://x --set mongodb.enabled=true) \
     <(helm template gitlaunch deploy/helm/gitlaunch --set config.publicUrl=http://x --set mongodb.enabled=true)
```

### What replaced it

[Sealed Secrets](https://github.com/bitnami-labs/sealed-secrets). A controller
in the cluster holds a private key; `kubeseal` encrypts with the matching public
key; the resulting `SealedSecret` is ciphertext that only that cluster can read,
so it is safe to commit. The controller decrypts it into an ordinary Secret,
which the chart consumes through `secrets.existingSecret` and
`mongodb.auth.existingSecret`.

The reason for this one rather than External Secrets Operator or Vault is the
first line of this README's rollback section: _the thing that shipped and the
thing you roll back to are both commits_. With an external store, git holds a
**reference** and `git revert` restores the reference while the value stays
whatever the store currently holds. With Sealed Secrets git holds the
**ciphertext**, so a revert restores the value itself. Secrets roll back with
the config that expects them, in one commit, under the same review.

`deploy/helm/gitlaunch` still generates secrets by default, because that is the
right default for `helm install` and for a customer's first run. These
environments opt out with `secrets.autoGenerate: false`, which is an interlock
rather than a preference: with it false the chart _refuses to render_ unless
both `existingSecret` values are supplied, so no code path is left that could
invent a credential during a sync. The property that matters is testable —

```bash
# identical, every time
diff <(helm template gitlaunch deploy/helm/gitlaunch -f deploy/envs/local/values.yaml) \
     <(helm template gitlaunch deploy/helm/gitlaunch -f deploy/envs/local/values.yaml)
```

`onprem`'s `googleClientId` / `googleClientSecret` pair stays in plaintext in
`values.yaml`. It authenticates against nothing — it exists to exercise the
"render the Google button" path — and calling it a secret would blur the line
this section is trying to draw.

### Changing a secret

```bash
openssl rand -base64 32 | deploy/envs/seal.sh set local app SOME_KEY
git add deploy/envs/local/secrets && git commit -m "chore(local): rotate SOME_KEY"
```

The value goes in on stdin, never as an argument, because arguments are visible
in `ps` and land in shell history. `set` merges into the existing ciphertext, so
rotating one key leaves the others byte-identical and the diff stays reviewable.

`deploy/envs/seal.sh verify <env>` compares the committed files against the live
Secrets by key set. Drift is otherwise invisible: pods keep running off whatever
the cluster holds, and the repo quietly loses the ability to rebuild the
environment.

### Migrating an environment that is already running

Ordering is the whole difficulty, and it is why this is a script rather than a
list of commands. The values being captured are the ones the running environment
is **already** using; generating fresh ones would strand the data encrypted
under the old key.

```bash
deploy/envs/seal.sh adopt local          # 1. capture live values -> ciphertext
kubectl apply -f deploy/envs/local/secrets   # 2. new Secrets exist
deploy/envs/apply.sh local               # 3. chart cuts over, prunes its own
deploy/envs/seal.sh verify local         # 4. confirm
```

Step 2 must precede step 3. The apply in step 3 is the first one where the chart
renders no Secret, so Helm prunes the two it used to own — the pods need
somewhere else to read from before that happens. The new Secrets deliberately
carry different names (`gitlaunch-app-secrets`, `gitlaunch-mongodb-secrets`)
than the ones the chart rendered, so there is no window where Helm and the
Sealed Secrets controller both believe they own the same object.

### Drill

Both environments were migrated this way on the running `lab` cluster, hashing
every secret value before and after rather than trusting that it worked:

| Step                                     | `local`                | `onprem`   |
| ---------------------------------------- | ---------------------- | ---------- |
| values hashed before adopt               | 5                      | 6          |
| values matching after seal → unseal      | 5/5                    | 6/6        |
| chart-owned Secrets after cutover        | 0 (pruned)             | 0 (pruned) |
| Helm revision                            | 8                      | 13         |
| MongoDB auth against the existing volume | ok, collections intact | ok         |
| `/health`                                | 200                    | 200        |

The hash comparison is the part worth keeping. "The pods came back up" would
have been equally true if `adopt` had sealed freshly generated values — the app
only reads `ENCRYPTION_KEY` when it decrypts a stored credential, so a wrong key
survives a restart and surfaces later, on whichever request first touches an
encrypted field. Comparing digests is what actually distinguishes _preserved_
from _regenerated_.

### The cost

The private key exists only in the cluster. `kind delete cluster` destroys the
ability to decrypt every SealedSecret in this repo, and the committed ciphertext
becomes worthless. This is the honest price of keeping secrets in git instead of
in a managed store, and it is paid with a backup:

```bash
deploy/argocd/backup-sealing-key.sh > ~/gitlaunch-sealing-key.yaml   # keep off this box
```

Two further caveats worth knowing before this pattern goes anywhere near a real
production cluster:

- **Sealing is cluster-bound.** Moving these environments to a different cluster
  means re-sealing every secret against the new controller's key.
- **Sealed Secrets does not rotate anything.** The controller renews its own
  sealing key every 30 days, which is not the same as rotating `encryptionKey`.
  Rotating an application secret is still a deliberate act — the `set` command
  above, plus whatever re-encryption the app needs. `ENCRYPTION_KEYS` (the
  keyring form documented in `CLAUDE.md`) is the mechanism for doing that one
  without downtime.

## Local prerequisites

The `local` environment needs three things the cluster cannot provide itself:

```bash
# 1. an image under the tag the values file names. Either seal the GHCR
#    credential and let the kubelet pull a CI tag (see "The release image"), or
#    build one locally and side-load it — pullPolicy: IfNotPresent takes
#    whichever is already in the node.
deploy/envs/build-image.sh

# 2. host :80 -> ingress. kind publishes :8080, and changing that means
#    recreating the cluster, which would take the onprem demo with it.
docker run -d --name gitlaunch-local-proxy --restart unless-stopped \
  --network kind -p 80:80 alpine/socat \
  tcp-listen:80,fork,reuseaddr tcp-connect:lab-control-plane:80
```

3. `gitlaunch.local` must resolve. Unlike `localtest.me`, `.local` does not
   resolve publicly, so it needs a hosts entry on both sides of WSL:

   - WSL: `echo "127.0.0.1 gitlaunch.local" | sudo tee -a /etc/hosts`
   - Windows: add `127.0.0.1 gitlaunch.local` to
     `C:\Windows\System32\drivers\etc\hosts` as Administrator.

Check it without any hosts entry:

```bash
curl -H "Host: gitlaunch.local" http://localhost/health
curl -H "Host: onprem.localtest.me" http://localhost:8080/health
```

## Gaps

Honest list of what this is not, in the order they block dogfooding:

1. ~~**No reconciler.**~~ Argo CD installs into the `lab` cluster with
   `deploy/argocd/bootstrap.sh`, and an `Application` per environment lives in
   `deploy/argocd/applications/`. Both run with `selfHeal: true`, which is what
   demotes `apply.sh` from "the thing that deploys" to a convenience that does
   the same thing faster. See [`deploy/argocd/README.md`](../argocd/README.md).

   Still hand-written: the image bump itself. Argo reconciles the image _tag_ in
   git; nothing yet writes a new tag into these files when CI publishes one, and
   `build-image.sh` remains the escape hatch for a tag CI never built.

2. ~~**Secrets do not survive render-then-apply.**~~ Solved before the
   reconciler, as it had to be — see [Secrets](#secrets). Both environments now
   render byte-identically twice in a row, which is the actual precondition.

3. **What the dashboard knows is a claim, not an observation.** `apply.sh` now
   reports through the same endpoint our CI does, so a rollback shows up as the
   older build going `deployed` again. But every reporter we have — this script,
   `deploy.yml`, the Jenkins and raw guides — reports what the _deployer intended
   to deploy_. Nothing asks the running process what it is actually running.

   For push-based providers that gap is narrow, since one actor does both halves.
   Pull-based GitOps is where it stops being narrow: nobody in the cluster claims
   anything, which is exactly why the design doc needs `/api/v1/gitops/events`
   plus the `Promotion` mapping to correlate a reconciler's config-repo SHA back
   to a build. A drift badge — "Argo says `OutOfSync` and no promotion is open" —
   needs an observation, not a claim.

   The revision is already stamped on the image as an OCI label, so surfacing it
   on `/health` would give us the observed side cheaply, for our own instances at
   least.

4. **No promotion ladder.** `local` and `onprem` now run the same artifact, so
   promoting between them is finally meaningful, but neither is upstream of the
   other — they are peers, not staging→prod. The promote path needs an ordered
   pair before it can be dogfooded.
