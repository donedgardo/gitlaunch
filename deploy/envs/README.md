# Our own environments, as a GitOps config repo

Desired state for the GitLaunch instances we run ourselves. One directory per
environment, one `values.yaml` each, applied against the chart in
`deploy/helm/gitlaunch`.

This exists so we can dogfood the GitOps model described in
[`docs/roadmap/GITOPS-SUPPORT.md`](../../docs/roadmap/GITOPS-SUPPORT.md) before
we ask a customer to. That design has GitLaunch write image bumps into a config
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

```bash
deploy/envs/apply.sh local
deploy/envs/apply.sh onprem
```

`apply.sh` is a stand-in for the reconciler we do not have yet. It is a plain
`helm upgrade --install` against the committed values. **The repo is only the
source of truth while nobody runs `helm upgrade --set` behind its back** — there
is no drift detection here yet (see Gaps).

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
- **The tag must be immutable.** `image.tag` is `sha-<commit>`, produced by
  [`build-image.sh`](build-image.sh), which stamps the revision as an OCI label
  and refuses to rebuild a tag that already exists. This is what makes rollback
  real: a moving tag like `latest` or the `local`/`config` tags these
  environments started on would let a revert change the file and nothing else —
  risk 3 in the design doc.

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

Nothing in these files authenticates against anything. `onprem`'s
`googleClientId` / `googleClientSecret` pair is a matching set of placeholders
that only exercises the "render the Google button" path.

Real secrets — `cookieSecret`, `encryptionKey`, MongoDB credentials — are
generated by the chart on first install and read back out of the live Secret on
every subsequent upgrade, so they stay stable without ever being committed.

**This is the part that breaks under Argo CD.** That read-back is a Helm
`lookup`, and `helm template` cannot see a cluster: a render-then-apply pipeline
would mint a new encryption key on every sync and strand every credential
already encrypted under the old one. Before a reconciler takes over, these
environments need `secrets.existingSecret` pointing at Secrets managed out of
band (Sealed Secrets, External Secrets, or `kubectl create secret` for the
laptop). Doing that swap safely means copying the live generated values into the
external Secret _before_ the first reconciled sync, because the chart stops
rendering — and therefore Helm prunes — the Secret it used to own.

## Local prerequisites

The `local` environment needs three things the cluster cannot provide itself:

```bash
# 1. the image, built under its commit tag and side-loaded into kind
#    (values set pullPolicy: Never, so nothing is ever fetched from a registry)
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

1. **No reconciler.** Nothing pulls. `apply.sh` is run by hand, so the repo can
   silently fall behind the cluster. Installing Argo CD into the `lab` cluster
   and pointing an `Application` at each of these paths is the next step, and
   the first thing that makes any of the rest real.
2. **Secrets do not survive render-then-apply** — see above. This must be
   solved before step 1, not after.
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
