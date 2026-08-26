# Enterprise Delivery Runbook

**Internal.** This is our side of a self-hosted sale — what we run, what we hand over, and
what happens at renewal. The customer-facing document is `docs/SELF-HOSTING.md`.

> **Status:** the tooling below is on `main` and every command has been run end to end.
> What is still missing is the _artifact_: no signed image or chart repository is published
> yet (workstream F in `docs/ENTERPRISE-ROADMAP.md`), so step 2 has nothing to hand over.
> The process is real; the distribution is not live.

---

## One-time setup (once, ever)

Generate the issuer keypair. Every license we ever sell is signed by it, and the matching
public key is compiled into every customer image.

```bash
tsx ee/scripts/issue-license.ts keygen ./issuer
#  -> issuer-private.pem   secret store only, never in git, never in an image
#  -> issuer-public.pem    compiled into customer images
```

**The private key is the licensing scheme.** Leak it and anyone can mint licenses; lose it
and every outstanding license has to be re-issued against a new key, which means rebuilding
and redistributing the image. Put it in the secret manager with the same care as a signing
key for released software.

---

## What is built per release vs per customer

Read this before the steps below, because the split is the whole point:

| Thing                  | How often                             | Why                                  |
| ---------------------- | ------------------------------------- | ------------------------------------ |
| The issuer keypair     | **Once, ever**                        | One key signs every licence we sell  |
| The distribution image | **Once per release** (1.0.0, 1.1.0 …) | Every customer pulls the same image  |
| A licence key          | **Once per customer**                 | Names the licensee, seats and expiry |

**We do not build per customer.** A licence is signed data, not compiled code — the image
verifies it at boot against the one issuer public key compiled in. So a sale is: run one
command, send one string. Nothing is rebuilt, republished or re-tagged.

That matters operationally. Per-customer builds would mean N images to patch for every CVE,
N upgrade paths to test, and a rebuild standing between us and closing a deal. Instead the
artifact is identical for everyone and only the entitlement differs.

The per-customer part of _access_ is separate: registry pull credentials are issued per
licensee, so we can cut off future pulls without touching the image anyone already holds.

## Building the distribution image

The published customer image is a _different build_ from gitlaunch.com. The difference is
compiled in, not configured at runtime:

```bash
tsx ee/scripts/set-distribution.ts self-hosted ./issuer-public.pem
yarn build
docker build -t ghcr.io/donedgardo/gitlaunch:1.0.0 .
```

`set-distribution.ts` rewrites `src/config/distribution.ts` before the
TypeScript build, stamping in both the distribution and the trusted issuer key. It refuses
to run if handed a private key or a non-Ed25519 key.

This is what makes the licensing hold: a customer runs this image on infrastructure they
control, so anything read from the environment is something they can set. The distribution
and the issuer key are therefore read from neither the environment nor the database.

> Never commit a stamped `distribution.ts`. The repository default is the hosted build
> (`saas`, no issuer key); stamping happens in the release pipeline.

---

## Per sale

### 1. Issue the license

No build step here — the image is already published. This mints signed data.

```bash
tsx ee/scripts/issue-license.ts issue \
  --to "Acme Corp" \
  --seats 50 \
  --expires 2027-07-27 \
  --key /secure/issuer-private.pem
```

- `--to` identifies the licensee and is shown back in the expiry message. Use the legal
  entity name from the contract.
- `--seats` is the only resource a license meters. Omit it for a site license with no seat
  cap — so that has to be a deliberate choice, not a default.
- `--expires` omitted issues a perpetual license.

The command verifies the license it just produced before printing it, so we never send a
key the customer's instance would reject.

### 2. Hand over

The customer needs four things:

| What                   | Notes                                                                |
| ---------------------- | -------------------------------------------------------------------- |
| The license key        | Treat as a secret in transit; it is theirs alone                     |
| Image coordinates      | `ghcr.io/donedgardo/gitlaunch:<version>` + registry pull credentials |
| The chart              | `deploy/helm/gitlaunch/`                                             |
| `docs/SELF-HOSTING.md` | Requirements, install, operations, known gaps                        |

### 3. Their install

Covered in `docs/SELF-HOSTING.md`. In short: a MongoDB connection string, a hostname, three
generated secrets, and the license key, then `helm install`. Their side never contacts us —
license verification is entirely local, which is what allows air-gapped installs.

### 4. Confirm it took

Ask them for the boot log, or check on a screen share:

- A honoured license logs nothing about licensing.
- A rejected one logs `GitLaunch license was not honoured: <reason>` and the instance falls
  back to **open core** — a working install, capped at one account and one seat. Services,
  repositories and environments stay unmetered.

The tell is therefore not an outage but a seat cap: the customer will report that they
cannot invite their team. Ask them for the boot log at that point.

The common causes are a truncated key (copy-paste through a chat client) and a key issued
against a different issuer keypair than the image trusts.

---

## Renewal and expiry

An expired license drops the instance back to _open core_ — one account, one seat.
Everything already running keeps deploying, existing members are never removed, and the
instance never goes read-only. Capacity (services, repositories, environments) stays
unmetered, because the FSL grants that whether or not they renew; what lapses is the thing
we actually sold, which is seats and tenancy.

That is deliberate and worth being explicit about in the contract: we do not hold a
customer's production pipeline hostage over a lapsed renewal, and an install that
crash-loops on expiry is an outage we inflicted on someone who paid us. Expiry is a
commercial event, enforced commercially, with a technical nudge — not a kill switch.

To renew, issue a new key with a later `--expires` and have them update the Secret:

```bash
kubectl -n gitlaunch create secret generic gitlaunch-secrets \
  --from-literal=GITLAUNCH_LICENSE_KEY='<new key>' \
  --dry-run=client -o yaml | kubectl apply -f -
kubectl -n gitlaunch rollout restart deploy/gitlaunch
```

There is no revocation. A license that is out in the world stays valid until it expires,
which is the main argument for selling fixed terms rather than perpetual licenses.

---

## What licensing actually buys us

Be honest internally about this.

A self-hosted customer owns the machine, the image and the database. Someone determined can
patch the compiled JavaScript and remove the check. **No client-side licensing scheme
survives an adversary with root**, and pretending otherwise leads to bad decisions like
phoning home, which is exactly what our air-gapped buyers will not accept.

What the scheme does buy:

- **No accidental unlicensed use.** An install cannot drift into unlicensed operation, and
  nobody can talk themselves into believing an env var was a supported configuration.
- **No easy bypass.** The escapes that would otherwise exist are closed: entitlement cannot
  be moved to the customer-owned database by claiming to be the hosted product, they cannot
  point the instance at their own issuer key, and no checkout flow is registered that could
  grant plan limits we did not sell.
- **A clear line for the contract.** Bypassing requires deliberately modifying a compiled
  binary. That is unambiguous license violation, which is what an audit clause and a legal
  remedy actually rest on.

Licensing here is a deterrent and an evidence trail, not a cryptographic guarantee.

---

## Open gaps before the first real sale

- **SSO/SAML/OIDC** is the most likely deal-blocker. Sign-in is GitHub OAuth, Google OAuth
  or email/password today.
- **No published image or chart repository.** The chart installs from a local path; there
  is no signed, versioned artifact to hand over yet.
- **No seat enforcement at invite time beyond the count.** Seats are metered from the
  license, but there is no grace or warning as a customer approaches the cap.
- **No in-app license visibility.** An operator cannot see licensee, seats or expiry from
  the dashboard — only from boot logs. This is the first thing to build next.
- **No backup/restore runbook** for the MongoDB that holds everything.
