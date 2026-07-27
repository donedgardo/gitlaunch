# Enterprise Roadmap — gaps, owners, sequencing

Work needed to actually sell and support self-hosted GitLaunch, decomposed so separate
agents can pick up workstreams in parallel without colliding.

**Gate: cleared.** PR #43 is merged — the entitlement seam, the build-time distribution
identity and the Helm chart are on `main`, so every workstream below is unblocked and wave 1
can start now. PR #44 adds the delivery runbook and self-hosting guide.

---

## Sequencing

```
    #43 MERGED — entitlement + distribution build + chart on main
              │
   ┌──────────┼──────────┬──────────────┬──────────────┐
   │          │          │              │              │
  [F]        [C]        [E1]           [D]           decide A's
publishing  licence   licensee        dogfood       pricing shape
 pipeline   page      registry        install         (no code)
   │          │          │              │              │
   └──────────┴────┬─────┴──────────────┘              │
                   │                                   │
                  [E2] delivery pipeline          ┌────┴────┐
                                                 [A]       [B]
                                              tiers/     SSO
                                            contact-sales
```

Wave 1 (parallel, low collision): **F, C, E1, D**
Wave 2 (after a product decision / larger): **A, B, E2**

### Collision map

Agents working simultaneously should know what else touches their files.

| Workstream             | Primary files                                                                                                                    | Collides with                                          |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| A — tiers              | `repositories/accountRepository.ts` (Plan enum, limits), `templates/onboarding/plan-selection.hbs`, `routes/settings/billing.ts` | **B** (accountRepository), **C** (billing/settings UI) |
| B — SSO                | new `routes/auth/oidc.ts`, `repositories/userRepository.ts`, `accountRepository.ts` (IdP config), `createAppServer.ts`           | **A** (accountRepository), **C** (createAppServer)     |
| C — licence page       | new `routes/settings/license.ts` + template, `createAppServer.ts`                                                                | **B** (createAppServer)                                |
| D — dogfooding         | CI workflow, cluster manifests. **No `src/` changes**                                                                            | none                                                   |
| E1 — licensee registry | new `repositories/licenseeRepository.ts`, `services/licensing/*`                                                                 | light — same dir as #43's licensing code               |
| E2 — delivery pipeline | `services/release/*`, dispatch                                                                                                   | **E1**                                                 |
| F — publishing         | `Dockerfile`, `.github/workflows/`, `scripts/`                                                                                   | none in `src/`                                         |

`createAppServer.ts` is the shared chokepoint — B and C both wire into it. Land C first (it
is small), then B rebases.

---

## A — Enterprise option in the tiers

**The decision to make first — these are two different products:**

1. **"Enterprise — contact sales" on the pricing page.** A funnel, not a plan. It routes to
   a conversation that ends in a self-hosted licence. Needs no `Plan` enum change. Can reuse
   the existing `LeadRepository` + waitlist capture path for the contact form.
2. **`Plan.Enterprise` as a real hosted tier.** For customers who stay on gitlaunch.com under
   negotiated terms — higher limits, invoice billing instead of self-serve Stripe, SSO on
   hosted. This _is_ an enum change and touches `PLAN_LIMITS_MAP`, the plan picker, and
   billing.

**Recommendation: do (1) now, defer (2).** Today "Enterprise" means self-hosted, and the
gap that costs us money is having no way for an interested buyer to raise their hand. (2) is
a real product with its own billing operations behind it; don't take it on until a customer
asks to stay hosted.

Note `.planning/REQUIREMENTS.md` still lists Enterprise/custom pricing as out of scope —
update it when this lands, or the requirements doc contradicts the product.

**Done when:** a pricing page shows a fourth tier, the contact form captures a lead with
attribution, and we get notified. No entitlement code changes.

---

## B — SSO

The most likely deal-blocker. Sign-in today is GitHub OAuth, Google OAuth, or
email/password.

**Scope OIDC first, SAML second.** OIDC covers Okta, Entra ID, Google Workspace, Auth0 and
Keycloak, and fits the existing model: `User` already carries multiple provider identities
(`githubId`, `googleId`, `passwordHash`), so this adds `oidcIssuer` + `oidcSubject` beside
them rather than reshaping anything. SAML is still contractually required by some large
buyers, but it is a much heavier lift — treat as a separate follow-up.

Per-account IdP configuration (issuer URL, client id, client secret) with the secret
encrypted at rest via the existing `secretBox` / `ENCRYPTION_KEY` path.

**Design question that needs an answer before coding:** just-in-time provisioning versus the
seat cap. If a licence sold 50 seats and the 51st employee signs in through the IdP, do we
block the login or admit them and flag the account over-cap? Blocking is hostile at the
moment of first impression; admitting silently means we stop metering the one thing the
licence meters. Suggested: admit, mark over-cap, surface it prominently on the licence page
(workstream C), and enforce commercially at renewal.

**Deferred:** SCIM provisioning/deprovisioning. Enterprises will ask; it is not first-sale
blocking.

**Done when:** an account can configure an OIDC IdP, users sign in through it, identities
link to existing users by verified email, and seat behaviour is decided and implemented.

---

## C — In-app licence visibility

Smallest useful item, and the best first parallel task. Right now an operator can only learn
their licence state from boot logs, which makes both support and renewal conversations
awkward.

A settings page (`/settings/license`, alongside apiKeys/billing/flags/github/jenkins/team)
showing: licensee, seats used vs sold, expiry with days remaining, and status — honoured, or
rejected with the reason.

The data mostly exists: `resolveInstanceMode` already computes `licenseError` at boot but
only logs it, and `resolveEntitlement` knows the limits and `blockedReason`. This is
plumbing that into a service and a page rather than new logic.

Add the seat warning the runbook names as a gap: warn as a customer approaches the cap,
rather than only failing at it.

**Done when:** an operator can see licensee, seats, expiry and status without shell access,
and gets a warning before hitting the seat cap.

---

## D — Dogfooding

We already dogfood feature flags (`GITLAUNCH_SERVICE_ID`, `selfFlagContext`). Extend that to
the distribution itself: run our own self-hosted instance, from the published image, with a
real licence we issued ourselves, and use it to manage our own deploys.

Value is specifically that **we hit the install path before a customer does** — the chart,
the licence flow, the upgrade path, and the seat cap all get exercised for real. Every
enterprise feature above gets a place to live before it ships.

**Done when:** a licensed self-hosted instance runs in our own cluster, is upgraded by our
own pipeline, and a real internal workflow depends on it.

---

## E — Managing delivery of licensed software

The product question: GitLaunch now has the problem of shipping licensed software to
customers who self-host. That is a general problem, and it is adjacent to what GitLaunch
already does.

Today's model is "deploy my app to my infrastructure." Licensed delivery is a different
shape: build an artifact, stamp and sign it, publish it, issue a licence, and know which
customer runs which version.

### Missing primitives

1. **Release** — an immutable, versioned, digest-pinned artifact set. _This already exists_
   as the model built in PR #41 (`worktree-platform-release-promotion`). That PR was the
   wrong answer to a different question and is unmerged, but the aggregate itself — immutable
   releases, digest-pinned artifacts, promotion between channels — is exactly the catalog
   primitive needed here. Reuse it rather than rebuilding.
2. **Licensee** — customer, contract term, seats, issued licences, entitled channel
   (stable/LTS), support window. Nothing like it exists today.
3. **Licence issuance as a service** rather than a local CLI: signing key in a KMS, an audit
   trail of who issued what to whom, renewal reminders.
4. **Publishing pipeline** — build → stamp → sign → push → publish chart → notify entitled
   licensees. This maps onto the existing dispatch model; a release pipeline is a dispatch
   with different inputs.
5. **Entitlement → artifact access.** Which licensee may pull which version, via per-licensee
   registry pull tokens. **This is the answer to "there is no revocation":** we cannot
   invalidate a licence already in the wild, but we can cut off future artifact pulls, which
   covers the realistic case of a lapsed customer wanting upgrades and support.
6. **Install attestation** — an optional signed usage report the customer exports and sends
   us, instead of phoning home. Gives seat and version visibility without breaking the
   air-gap guarantee we are selling.

### Recommended first slice — E1, the licensee registry

`issue-license.ts` is stateless: it signs a key and forgets. **We cannot currently answer
"what did we sell Acme, and when does it expire?"** That is the thing that hurts first, it is
small, and everything else in E builds on it.

Record every issued licence: licensee, seats, expiry, issuing operator, timestamp, and the
key's fingerprint. Start it as storage behind the existing script, not a UI.

### E2 — delivery pipeline

Only after E1 and F. Wire the release catalog to the publishing pipeline and per-licensee
artifact access.

**Is this a product?** Possibly — "GitLaunch for vendors who ship self-hosted software" is a
coherent adjacent offering, and dogfooding is the natural path to it. But it is a product
bet, not a gap to close. Treat E1 as infrastructure we need regardless, and revisit the
product question once we have run a few real sales through it.

---

## F — Publishing pipeline (not on the original list, but P0)

**There is nothing to hand a customer today.** The chart installs from a local path, and no
image is published. This blocks the first sale outright, which is why it belongs in wave 1
even though it is unglamorous.

Needs: a versioned, signed image (cosign) in a registry, a published chart, a tagged release
process, and per-customer pull credentials. Also a build that runs `set-distribution.ts` with
the issuer public key — and a guard that a stamped `distribution.ts` never reaches `main`.

**Done when:** a tagged release produces a signed image and chart a customer can pull with
credentials we issue.

---

## Not covered anywhere yet — the commercial half

Named here so it does not keep falling through: contract template, audit clause wording,
pricing and seat guidance, support and SLA commitments, and a security questionnaire /
SOC-2 story. Every enterprise buyer asks for these, none of them exist in the repo, and none
are engineering tasks.
