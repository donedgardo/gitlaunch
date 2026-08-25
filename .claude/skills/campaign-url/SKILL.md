---
name: campaign-url
description: Build a shareable marketing link with UTM tracking parameters, and optionally shorten it. Use when the user runs /campaign-url or asks to create a campaign / tracking / UTM link for sharing on social, email, ads, or newsletters.
allowed-tools:
  - AskUserQuestion
  - Bash
---

# Campaign URL Builder

Turn a plain destination URL into a properly tagged marketing link using the
standard Google Analytics UTM scheme, then optionally shorten it for sharing.

## When to use

Invoked as `/campaign-url`, or whenever the user wants a trackable link for a
specific channel (Twitter/X, LinkedIn, a newsletter, a paid ad, a QR code, etc).

## The UTM scheme

A campaign URL is `<destination>?<utm params>`. The five standard parameters:

| Parameter      | Required | Meaning                                     | Examples                          |
| -------------- | -------- | ------------------------------------------- | --------------------------------- |
| `utm_source`   | yes      | Where the traffic comes from (the referrer) | `twitter`, `newsletter`, `google` |
| `utm_medium`   | yes      | The marketing channel / delivery mechanism  | `social`, `email`, `cpc`, `qr`    |
| `utm_campaign` | yes      | The specific campaign or promotion          | `launch_2026`, `summer_sale`      |
| `utm_term`     | no       | Paid-search keyword                         | `deployment_tool`                 |
| `utm_content`  | no       | Distinguishes variants (A/B, ad, position)  | `hero_cta`, `footer_link`         |

## Workflow

### 1. Gather context

Use **AskUserQuestion** to collect the link context. Ask in ONE call (multiple
questions) unless the user already supplied some values in their message — never
re-ask for anything they already gave you.

- **Destination URL** — the page being promoted. If not given, ask for it. Do
  not offer canned options for this; it's free-text.
- **Source** (`utm_source`) — offer common options (e.g. Twitter/X, LinkedIn,
  Newsletter, Google) plus let them type their own.
- **Medium** (`utm_medium`) — offer `social`, `email`, `cpc`, `referral`, `qr`.
- **Campaign** (`utm_campaign`) — free-text; suggest a value derived from context
  (e.g. the current month/year or a product name) but let them override.
- **Term / Content** — only ask if relevant (paid search or A/B variants). Skip
  by default to keep the flow short; mention they can add them.

### 2. Normalize the values

Keep tracking data clean and consistent — analytics tools are case-sensitive and
treat `Email` and `email` as different sources:

- Lowercase every UTM value.
- Replace spaces with underscores (`summer sale` -> `summer_sale`).
- Strip characters that aren't alphanumeric, `_`, or `-`.
- URL-encode each value when assembling the query string.

### 3. Assemble the URL

- Preserve any existing query string on the destination — append UTMs with `&`
  if the URL already has a `?`, otherwise start with `?`.
- Order params: source, medium, campaign, term, content (omit empty optionals).
- Preserve any `#fragment` by putting it at the very end, after the query.

Prefer building it deterministically with a small shell snippet rather than by
hand, so encoding is correct. Example:

```bash
python3 - "$DEST" "$SOURCE" "$MEDIUM" "$CAMPAIGN" "$TERM" "$CONTENT" <<'PY'
import sys, urllib.parse as u
dest, src, med, camp, term, content = (sys.argv[1:7] + [""]*6)[:6]
def norm(v):
    v = v.strip().lower().replace(" ", "_")
    return "".join(c for c in v if c.isalnum() or c in "_-")
parts = u.urlsplit(dest)
q = u.parse_qsl(parts.query, keep_blank_values=True)
for k, v in [("utm_source",src),("utm_medium",med),("utm_campaign",camp),
             ("utm_term",term),("utm_content",content)]:
    if v.strip():
        q.append((k, norm(v)))
new = parts._replace(query=u.urlencode(q))
print(u.urlunsplit(new))
PY
```

### 4. Optionally shorten

Ask whether to shorten the link (AskUserQuestion: Yes / No). If yes, call a free,
no-auth shortener and return the short URL alongside the full one. Use TinyURL
(no key required); a successful call returns a bare `https://tinyurl.com/...`:

```bash
curl -s --max-time 10 "https://tinyurl.com/api-create.php?url=$(python3 -c 'import sys,urllib.parse as u;print(u.quote(sys.argv[1],safe=""))' "$LONG_URL")"
```

Fallback to `is.gd` if TinyURL errors:

```bash
curl -s --max-time 10 "https://is.gd/create.php?format=simple&url=$(python3 -c 'import sys,urllib.parse as u;print(u.quote(sys.argv[1],safe=""))' "$LONG_URL")"
```

A valid short URL starts with `http`. If the response is an error message (e.g.
`Error, ...`) or the environment has no network access, treat it as a failure:
say so plainly and hand back the full UTM link — it still works.

### 5. Present the result

Show the user, in a code block for easy copying:

- The **full campaign URL**.
- The **short URL** (if created).
- A one-line **breakdown** of the UTM tags applied, so they can sanity-check the
  tracking before sharing.

Example output:

```
Full:  https://gitlaunch.io/pricing?utm_source=twitter&utm_medium=social&utm_campaign=launch_2026
Short: https://tinyurl.com/abc123

Tags:  source=twitter · medium=social · campaign=launch_2026
```

## Notes

- Never fabricate a short URL — only report one actually returned by the API.
- If the user gives everything up front ("make a Twitter link for gitlaunch.io/pricing
  for the launch_2026 campaign"), skip the questions and go straight to building.
- This skill only assembles and shortens links; it does not store or track them.
