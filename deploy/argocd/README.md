# Argo CD in the `lab` cluster

The reconciler for [`deploy/envs`](../envs). Closes gap 1 there: something pulls
now, so the repo is the source of truth rather than the usual source.

```bash
GITHUB_TOKEN=ghp_... deploy/argocd/bootstrap.sh              # tracks main
GITHUB_TOKEN=ghp_... deploy/argocd/bootstrap.sh --revision my-branch
```

| Piece                                | What it is                                            |
| ------------------------------------ | ----------------------------------------------------- |
| `bootstrap.sh`                       | Installs sealed-secrets + Argo CD, registers the apps |
| `applications/gitlaunch-local.yaml`  | `local` -> namespace `gitlaunch-local`                |
| `applications/gitlaunch-onprem.yaml` | `onprem` -> namespace `onprem`                        |
| `backup-sealing-key.sh`              | The one thing you must keep outside the cluster       |

`bootstrap.sh` is imperative on purpose: it is the code that runs before there
is a reconciler to run anything. Everything it installs is either pinned
upstream or generated from a credential that must not be committed. Our own
desired state is the declarative part, in `applications/`.

## Is Argo CD the secret management strategy?

No, and it is worth being precise about why, because "we run Argo CD" is often
said as though it answered the question.

Argo CD's own documentation is direct about this: it recommends secrets be
managed **on the destination cluster**, and lists Sealed Secrets, External
Secrets Operator and the Secrets Store CSI driver as the ways to do it. It
explicitly cautions against the alternative — plugins that inject secrets during
manifest generation, such as `argocd-vault-plugin` — because **Argo CD stores
generated manifests in plaintext in its Redis cache**. Secrets that pass through
rendering end up cached in the clear. The project also says it will not
prioritise features that only serve that style.

So Argo CD is the thing that made our secret handling a problem, and it is not
the thing that solves it:

- It **created** the constraint. Argo renders with `helm template`, which has no
  cluster access, so the Helm `lookup` our chart used to preserve generated
  secrets returns empty on every sync. Support for `lookup` is a long-standing
  open request, and the `--dry-run=server` workaround would require handing the
  repo-server cluster credentials during rendering — reintroducing exactly the
  coupling `helm template` avoids.
- It **enforces** the solution. `selfHeal: true` means a hand-run
  `helm upgrade --set` gets reverted, and `prune: true` means a resource deleted
  from git is deleted from the cluster. Both are only safe once no secret is
  chart-rendered — a prune against the old arrangement would have deleted the
  encryption key.

What we needed was a **secret store with versioning**, and that is a separate
choice from the reconciler. See [Secrets](../envs/README.md#secrets) for why
Sealed Secrets rather than ESO: git holds ciphertext, so `git revert` restores a
secret's value, not merely a pointer to wherever the value now lives.

## Why three sources per Application

A Helm `valueFiles` entry cannot escape the chart directory — Argo rejects paths
outside the base directory — so a chart in `deploy/helm/gitlaunch` cannot
directly reference `deploy/envs/local/values.yaml`. The documented way around it
is a second source carrying `ref: values`, which contributes no manifests and
exists only to give `$values` a root. The third source applies that
environment's sealed secrets as plain manifests.

On a first sync the app pod can briefly fail to start while the controller is
still turning the SealedSecret into a Secret. `envFrom` against a missing Secret
is a `CreateContainerConfigError`, the kubelet retries, and it converges without
intervention.

## Bootstrap credentials

`launchpad` is a private repo, so Argo cannot read its own desired state until
something hands it a credential. That credential is the one secret that cannot
be sealed into this repo — sealing it here would require Argo to already be able
to read the repo it needs the credential to read. `bootstrap.sh` creates it from
`$GITHUB_TOKEN`; without one, the Applications sync-fail with a 401.

This is not a gap so much as where the chain has to be anchored. Every GitOps
setup has exactly one of these.

## Images

The kind cluster runs images side-loaded by `deploy/envs/build-image.sh` under
`pullPolicy: Never`. Argo reconciles the image tag in git; it cannot fetch or
build the image behind it. Promoting to a tag that is not on the node yet leaves
pods in `ErrImageNeverPull` until you build and load it. A registry would remove
this step, and would also make the promotion story honest for anything that is
not a laptop.

## Verified / not verified

Run against the `lab` cluster:

| Step                                                       | Result                                   |
| ---------------------------------------------------------- | ---------------------------------------- |
| sealed-secrets controller installs, mints a key            | yes                                      |
| `seal.sh adopt` on both live environments                  | yes                                      |
| sealed values decrypt to the originals                     | yes — 11/11 values, hash-identical       |
| chart cuts over, Helm prunes the Secrets it owned          | yes, both environments                   |
| app authenticates to the pre-existing MongoDB volume       | yes — data intact, `/health` 200 on both |
| `seal.sh verify` detects injected drift                    | yes                                      |
| `seal.sh set` leaves other keys' ciphertext byte-identical | yes — one-line diff                      |
| Argo CD installs                                           | yes                                      |
| both Applications reach `Synced` / `Healthy`               | yes                                      |
| secrets survive Argo's first sync with prune + selfHeal    | yes — 11/11 still hash-identical         |
| `selfHeal` reverts a hand-scaled deployment                | yes, ~20s                                |
| the pre-push guard refuses an unmigrated revision          | yes                                      |

That third-from-last row is the one this whole change exists for. Argo's first
sync with `prune: true` is precisely the moment the old arrangement would have
regenerated the encryption key. Every value came through untouched, measured by
digest rather than by "the pods came back up".

Two bugs only the live run could find, both now fixed: `git ls-tree` resolves
pathspecs relative to the working directory, so the guard was refusing correctly
migrated environments; and Argo defaults the Helm release name to the
_Application_ name, which collided with the existing release and would have
pointed the app at a MongoDB host that does not exist.

The committed Applications say `targetRevision: main`, which is where they
should point once this merges. They are currently running against
`worktree-gitops-own-envs` via `bootstrap.sh --revision`.
