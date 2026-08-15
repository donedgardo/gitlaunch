# Examples

Throwaway projects for exercising the [`gitlaunch-onboarding`](../skills/gitlaunch-onboarding/SKILL.md)
skill — the agent flow offered on onboarding step 2, where a customer's coding
agent wires their repo up to GitLaunch and opens a PR.

These are fixtures, not products. Nothing here is shipped or imported by the app.

| Example           | Stack                          | Exercises                     |
| ----------------- | ------------------------------ | ----------------------------- |
| `dummy-react-app` | Vite + React + TS, npm, vitest | Case A — a repo with no CI/CD |

## Running a test round

```bash
./examples/new-sandbox.sh dummy-react-app --push <owner>/gl-sandbox-react
```

That copies the example (minus `node_modules`/`dist`) into a temp directory,
makes it a git repo on `main`, and creates a private GitHub repo with it. Drop
`--push` to stay local — enough to test detection and file writing, but
`gh pr create` and the deploy binding need a real remote.

Then, in GitLaunch: create a service, mint an API key, and copy the prompt from
onboarding step 2. Run your coding agent in the sandbox directory with that
prompt and let it work.

## What a correct run looks like

For `dummy-react-app` (Case A — no `.github/`, no `Jenkinsfile`, nothing):

- [ ] Says it detected **Case A** and why, before editing anything
- [ ] Detects **npm** from `package-lock.json` — not yarn, not pnpm
- [ ] Uses the real scripts: `npm ci`, `npm test`, `npm run build`. There is no
      `lint` script; a workflow that runs one is invented
- [ ] Fetched `/setup-snippets` rather than writing the YAML from memory
- [ ] A build workflow whose final job ends with the build-report step
- [ ] `deploy.yml` declaring **exactly** `environment` and `buildId` inputs
- [ ] The deploy step left as a **placeholder** — this app's README says only
      "ship `dist/` wherever static files go", which is not enough to know how it
      deploys. Inventing a deploy step here is a failure, not initiative
- [ ] The `if: github.ref == 'refs/heads/main'` guard matches the sandbox's
      default branch (`main`)
- [ ] The API key appears in **no** tracked file — check with
      `git log -p | grep -c '<key prefix>'`
- [ ] A PR, on a branch, never a push to `main`
- [ ] PR body mentions that dispatch only works once merged to the default branch

Then verify for real rather than by reading the YAML:

```bash
curl --fail-with-body -sS "<host>/api/v1/services/<serviceId>/builds" \
  -H "Authorization: Bearer <apiKey>"
```

If the report step is gated to `main`, no build appears until the PR merges —
that is correct behaviour, not a failure.

## Cleaning up

```bash
gh repo delete <owner>/gl-sandbox-react --yes
rm -rf /tmp/gitlaunch-sandbox-*
```

Revoke the API key at `<host>/settings/api-keys` when done — sandbox keys are
real keys.

## Adding an example

One directory per fixture, named for what it is, with a `README.md` that reads
like a normal project README. Keep CI/CD out of it unless the fixture's whole
point is an existing pipeline (Case B or C) — then commit exactly the pipeline
being tested and note it in the table above.
