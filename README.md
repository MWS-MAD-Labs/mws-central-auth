# mws-central-auth

Shared building blocks for MWS apps that integrate with the central identity
system. Two independent entry points, so a pure backend never has to install
React just to verify a token, and a frontend never has to install `zod`
just to render a status page:

- `mws-central-auth` — reusable status/error page components (e.g. "your
  account isn't registered centrally").
- `mws-central-auth/server` — verifies mws-hub SSO relay tokens (RS256,
  audience/issuer/expiry checks, single-use `jti` enforcement).

Consumed as a git dependency, not published to npm.

## Install

```json
"dependencies": {
  "mws-central-auth": "git+https://github.com/MWS-MAD-Labs/mws-central-auth.git#v0.3.0"
}
```

`npm install` clones the tag and runs this package's `prepare` script
(`tsup` build) automatically — no manual build step needed on the consumer
side.

## Usage: SSO relay token verification (`mws-central-auth/server`)

### How the token reaches your backend

Hub's `/apps/:appId/launch` no longer puts the token itself in the browser
redirect. Instead:

1. Hub redirects the browser to your app's entry URL with a short-lived,
   single-use opaque code: `https://your-app.example/auth/sso?code=<code>`.
2. Your app's **backend** (never the browser) exchanges that code for the
   real token by calling Hub directly, server-to-server:

   ```
   POST https://hub.example.sch.id/sso/exchange
   Headers: X-Hub-Internal-Secret: <the shared secret your deployment already has>
   Body: { "code": "<code from the query string>", "appId": "<your app's sso.appId>" }
   Response: { "data": { "token": "<the relay token>" } }
   ```

3. You verify that `token` exactly as below.

The token itself never sits in a URL, a server access log, or browser
history this way - only the low-value opaque code does, and that code is
useless to anyone who doesn't also have the shared secret.

### Verifying the token

```ts
import { verifyRelayToken, RelayTokenVerificationError } from "mws-central-auth/server";

// Recommended: dynamic JWKS lookup, so Hub can rotate its signing key
// without every satellite app needing a redeploy.
const identity = await verifyRelayToken(token, {
  audience: "learnspace", // must match this app's sso.appId in Hub's catalog
  jwksUrl: "https://hub.example.sch.id/.well-known/jwks.json",
});

// Alternative: a single fixed public key (matches the older
// HUB_SSO_PUBLIC_KEY env var pattern mws-mtss-system/mws-daily-checkin used).
// A key rotation on Hub's side requires updating this and redeploying.
const identity = await verifyRelayToken(token, {
  audience: "learnspace",
  publicKeyPem: process.env.HUB_SSO_PUBLIC_KEY,
});
```

`identity` is `{ iss, aud, sub, email, source, tags, jti, iat, exp }`.

**`sub` is Central's stable `Person.id` — this is the identity to key your
own session/user records on, always.** `email` is carried too, but only as
a display/contact attribute: Central allows editing an employee's email
(`EmployeeValidation.UPDATE`), so a lookup or session keyed by email can go
stale the moment someone's email changes there, silently, mid-session. `sub`
never has that problem. `source` is `"employee" | "student"`, `tags` are the
Central-backed access keys Hub's app catalog admitted them with. The token
itself does not carry a full profile (name, unit, job position, ...) - look
that up from Central's own `/employees/lookup` or `/students/lookup` (both
accept an `id` query param matching `sub`'s `Person.id` via their
`person_id` response field) or the combined `/persons/lookup?email=` at
first sign-in, when you only have an email yet.

Every failure (bad signature, wrong audience, expired, already-used `jti`,
...) throws `RelayTokenVerificationError` with no indication of which check
failed — treat every failure the same way (redirect to a generic sign-in
error), never surface the specific reason to the browser.

Replay protection defaults to an in-process `Map` (`InMemoryReplayStore`),
fine for a single instance but not shared across instances behind a load
balancer. An app that scales horizontally should inject its own
`ReplayStore` (a Postgres row, a Redis key, ...) via the `replayStore`
option instead of relying on the default.

## Usage: status/error pages (`mws-central-auth`)

```tsx
import { StatusMessagePage } from "mws-central-auth-ui";

<StatusMessagePage
  title="Account Not Found"
  message="Your account is not registered in our database..."
  actions={[
    { label: "Back to Sign In", onClick: () => navigate("/") },
    { label: "Contact Administrator", href: "mailto:admin@millennia21.id" },
  ]}
/>;
```

`StatusMessagePage` is presentational only — no router, no state
management, no app-specific context. The consuming app owns routing,
page-transition animation, and document title; this component just renders
the card.

By default it renders with its own standalone colors (no assumption that
the host app defines any particular CSS variables). Pass `theme` to match
your app's own design system instead:

```tsx
<StatusMessagePage
  title="Account Not Found"
  message="..."
  actions={[...]}
  theme={{
    cardBackground: "hsl(var(--card) / 0.6)",
    cardBorder: "hsl(var(--border) / 0.4)",
    primary: "hsl(var(--primary))",
    primaryForeground: "hsl(var(--primary-foreground))",
    foreground: "hsl(var(--foreground))",
    mutedForeground: "hsl(var(--muted-foreground))",
  }}
/>
```

## Local development

```
bun install
bun run build
```

(Consumers install this package via npm as a git dependency — see
"Install" above — since that's each consuming app's own stack. `bun` here
is only for developing this repo itself.)
