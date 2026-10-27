# mws-central-auth

Shared building blocks for MWS apps that integrate with the central identity
system. Three independent entry points, so a pure backend never has to install
React just to verify a token, and a frontend never has to install `zod`
just to render a status page:

- `mws-central-auth` — reusable status/error page components (e.g. "your
  account isn't registered centrally").
- `mws-central-auth/server` — verifies mws-hub SSO relay tokens (RS256,
  audience/issuer/expiry checks, single-use `jti` enforcement) and exchanges
  Hub launch codes server-to-server.
- `mws-central-auth/data-client` — reads Central's internal profile and
  application-entitlement APIs.

Consumed as a git dependency, not published to npm.

## Install

```json
"dependencies": {
  "mws-central-auth": "git+https://github.com/MWS-MAD-Labs/mws-central-auth.git#v0.6.0"
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
   real token by calling Hub directly, server-to-server. The optional `state`
   value is included when your launch flow uses one:

   ```
   POST https://hub.example.sch.id/sso/exchange
   Headers: X-Hub-Internal-Secret: <the shared secret your deployment already has>
   Body: { "code": "<code from the query string>", "appId": "<your app's sso.appId>", "state": "<optional state>" }
   Response: { "data": { "token": "<the relay token>" } }
   ```

3. You verify that `token` exactly as below.

The token itself never sits in a URL, a server access log, or browser
history this way - only the low-value opaque code does, and that code is
useless to anyone who doesn't also have the shared secret.

```ts
import { HubExchangeClient } from "mws-central-auth/server";

const hub = new HubExchangeClient({
  baseUrl: "https://hub.example.sch.id",
  internalSecret: process.env.HUB_INTERNAL_SECRET!,
  appId: "learnspace",
});

const token = await hub.exchangeCode(code, state); // state is optional
```

Exchange failures throw `HubExchangeError` with one generic message, whether
Hub rejected the code, returned an invalid response, or could not be reached.

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

`identity` is `{ iss, aud, sub, email, source, tags, jti, iat, exp,
entitlement? }`. Old relay tokens without `entitlement` remain valid. When
present, `entitlement` is `{ id, application_id, organization_id, role,
permissions, version }`.

**`sub` is Central's stable `Person.id` — this is the identity to key your
own session/user records on, always.** `email` is carried too, but only as
a display/contact attribute: Central allows editing an employee's email
(`EmployeeValidation.UPDATE`), so a lookup or session keyed by email can go
stale the moment someone's email changes there, silently, mid-session. `sub`
never has that problem. `source` is `"employee" | "intern" | "student"`, `tags` are the
Central-backed access keys Hub's app catalog admitted them with. The token
itself does not carry a full profile (name, unit, job position, ...) - look
that up from Central's own `/employees/lookup`, `/interns/lookup` or `/students/lookup` (each
accepts an `id` query param matching `sub`'s `Person.id` via their
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

For race-free distributed replay protection, implement `AtomicReplayStore`
with `consume(jti, ttlSeconds)`, returning `true` only for the first consumer.
`verifyRelayToken` prefers this atomic method. Existing `ReplayStore`
implementations with `hasSeen` and `markSeen` remain supported for backward
compatibility. `InMemoryReplayStore` implements both interfaces.

## Usage: Hub sign-in and sign-out flow (`mws-central-auth/server`, `mws-central-auth/client`)

Every app does the same four things, and all the logic lives in `createHubSso`. An app only wires routes to it.

```ts
import { createHubSso } from "mws-central-auth/server";

const sso = createHubSso({
  hubBaseUrl: process.env.HUB_BASE_URL!,
  appId: "my-app",                         // the id in Central and the Hub
  internalSecret: process.env.HUB_INTERNAL_SECRET!,
});
```

1. `GET /auth/hub` (the app starts a sign-in): `const { url, cookie } = sso.launch.begin()`, set `cookie` and redirect to `url`.
2. `GET /auth/sso` (the Hub sends the person back with `?code=`): `sso.callback.decide({ code, state, cookieState })`.
   `"restart"` means the Hub started this (a card click, no `state`): redirect to `/auth/hub`. `"reject"` is an error.
   `"continue"`: clear the cookie (`sso.callback.clearCookie()`), then `await sso.exchange(code, state)` and verify the token.
3. `GET /auth/logout` (the person pressed Logout): clear the app's own session, then redirect the browser, in the same tab,
   to `sso.logoutUrl(email)`. Only this app signs out: the Hub keeps its session and the other apps stay signed in. The browser lands on the Hub front page.
4. `POST /auth/revoke-session` (the Hub ends sessions): `sso.revoke.handle({ secret, body, apply })`. `apply` receives
   `{ personId, email, all }` and ends those sessions (usually by bumping a session version). Return whether anyone was affected.

In the browser, `watchSession({ check, onRevoked })` from `mws-central-auth/client` asks whether the session is still valid
when a tab comes back into view, so a sign-out in another app shows up at once.

Starter apps for Express and Next.js (shared session, and the relay flow above) live in `templates/` (see `templates/README.md`). `zod` (version 4 or newer) must be installed next to the package.

An app's logout address is saved once in Central (`.../auth/logout`). The Hub derives the silent logout page and the
`/auth/revoke-session` call from it.

## Usage: shared session for apps on the Hub's parent domain (`createHubSession`, `keepFresh`)

When the Hub and the app are on the same parent domain (for example `hub.example.org` and `exima.example.org`), the app needs no sign-in flow, no session of its own and no sign-out. The Hub keeps two cookies (see the Hub README): a short access token on the parent domain that every app can read, and a refresh token only the Hub can use. Signing out of the Hub signs the person out of every app.

```ts
import { createHubSession } from "mws-central-auth/server";

const hub = createHubSession({ hubBaseUrl: process.env.HUB_BASE_URL! });

// On every request:
const claims = await hub.fromCookieHeader(request.headers.get("cookie")); // { sub, email, source, tags, sid } or null
switch (hub.step({ claims, restored: url.searchParams.has("restored") })) {
  case "ok":      /* serve it; get the app's own role and permissions from Central for claims.sub */ break;
  case "restore": /* redirect to hub.restoreUrl(currentUrl): the Hub gives a new token back if the person still has a session */ break;
  case "hub":     /* redirect to hub.homeUrl(): no session, the person picks an app there */ break;
}
```

Create the session once and reuse it: it remembers the cookie name. The name is, in order: `cookieName` in the options, `HUB_ACCESS_COOKIE_NAME` from the environment, what the Hub reports at `/.well-known/hub-config` (asked on the first request and again every 10 minutes, in the background), then `hub_at`. Only the cookie name comes from the Hub; the audience and issuer stay what the app sets (`mws-apps` and `mws-hub` by default). `readCookie` is synchronous and uses the name known so far, so an app that depends on the Hub's answer can `await hub.ready()` at start-up. Over http the Hub is only asked outside production. `discovery: false` turns it off.

In the browser, keep the token fresh while the page is open:

```ts
import { keepFresh } from "mws-central-auth/client";

keepFresh({ refreshUrl: hubRefreshUrl, onEnded: () => (location.href = hubHomeUrl) });
```

Which way an application signs in is set per application in Central (Sign-In Way: Shared Hub Session or Hub Code and Token), and the `.env` block Central shows follows it: the shared way needs only `HUB_BASE_URL`, no Hub secret. The app gets only identity from the token. What the person may do in the app comes from Central (the entitlement lookup), as before. `createHubSso` (the code and relay token flow above) stays for apps that are not on the parent domain.

## Usage: Central data client (`mws-central-auth/data-client`)

This client is frozen. It keeps what is shared and rarely changes: the entitlement and employee lookups, the permission manifest (`publishPermissions`, `comparePermissions`), `CentralApiError` and their types. New Central endpoints are not added here. An app that needs more calls Central itself (see `CentralHttpClient` in MWS-Learnspace for a small example), so a new endpoint never waits for a release of this package.

```ts
import { CentralDataClient } from "mws-central-auth/data-client";

const central = new CentralDataClient({
  baseUrl: "https://central.example.sch.id",
  token: process.env.CENTRAL_DATA_API_TOKEN!,
});

const entitlement = await central.lookupApplicationEntitlement({
  person_id: identity.sub,
  application_id: "learnspace",
});
```

`lookupApplicationEntitlement` returns `null` for a Central `404`. Network
errors and every other non-success response throw `CentralApiError`.

The exact `ApplicationEntitlement` contract is:

```ts
{
  id: string;
  person_id: string;
  application_id: string;
  organization_id: string;
  role: string;
  permissions: string[];
  version: number;
  is_active: boolean;
  granted_at: string;
  updated_at: string;
}
```

## Usage: the access kit (`mws-central-auth/access`, `access/cli`, `mws-access`)

One implementation of what every app does with permissions (Access Standard, `mws-data-center/docs/access-standard.md`), so apps do not copy it. Use these instead of writing your own:

```ts
// src/permissions.ts: the one list of the app's permissions. It checks itself when it is loaded (AS-3, AS-4).
import { definePermissions } from "mws-central-auth/access";

export const permissions = definePermissions({
  application: "inventory",
  permissions: [
    { key: "inventory.use", description: "Sign in" },
    { key: "inventory.read", description: "See items", requires: ["inventory.use"] },
    { key: "inventory.manage", description: "Add, change and delete items", requires: ["inventory.read"] },
  ],
});
```

```ts
// scripts/permissions.ts: permissions:sync and permissions:check, the same in every app (AS-4). Three lines.
import { runPermissionsCli } from "mws-central-auth/access/cli";
import { permissions } from "../src/permissions";

process.exit(await runPermissionsCli({ application: permissions.application, manifest: permissions.manifest }));
// npm run permissions:sync -- [--confirm-removals] [--retries 5 --wait 20]   |   npm run permissions:check -- [--soft]
// Reads CENTRAL_API_BASE_URL and CENTRAL_API_TOKEN (and CENTRAL_ORGANIZATION_ID when set).
```

```ts
// Where the app turns a person into permissions (AS-10, AS-11).
import { can, createAccessResolver } from "mws-central-auth/access";
import { CentralDataClient } from "mws-central-auth/data-client";

const central = new CentralDataClient({ baseUrl, token, organizationId });
const access = createAccessResolver({
  application: permissions.application,
  permissions: permissions.keys,
  organizationId, // refuses an entitlement of another organization
  lookup: (personId) => central.lookupApplicationEntitlement({ person_id: personId, application_id: permissions.application }),
});

const result = await access.resolve(claims.sub);
if (result.status === "denied") /* turn the person away; result.reason says why */;
if (result.status === "unavailable") /* Central cannot be asked: show your own message, nothing is granted */;
if (result.status === "allowed" && can(result.permissions, "inventory.manage")) { /* ... */ }
```

The resolver keeps an answer for at most 60 seconds and "no access" for 30, asks Central once for simultaneous requests, never grants a permission the manifest does not list (it comes back in `ignored`), and needs `<application>.use`. Call `access.invalidate(personId)` to forget someone at once.

`mws-access check` runs the conformance checks below the same way in every app, from an `access.config.json` at the root of the app:

```json
{
  "application": "inventory",
  "manifest": "src/permissions.ts",
  "presets": "role-presets.json",
  "source": { "roots": ["src"], "manifestFiles": ["src/permissions.ts"] },
  "roleNames": ["ADMIN", "CLERK"],
  "probe": { "module": "scripts/access-probe.ts", "open": ["GET /health/*", "GET /me"] }
}
```

Run it in CI: `node --import tsx node_modules/mws-central-auth/dist/access/bin.js check` (a `.ts` manifest or probe needs tsx or bun; plain JSON and JS do not). The probe module exports `createProbe()`, which starts the app and returns `{ routes, call(route), close() }`; each route is sent as a signed-in person with no permissions and must answer 401 or 403.

`mws-access doctor` answers "why does nobody get in?" the same way in every app, with the same `access.config.json`:

```bash
node --import tsx node_modules/mws-central-auth/dist/access/bin.js doctor --url http://localhost:3011
```

It reads the app's `.env` (or `--env-file`) and the environment, then checks: the lines Central hands out plus `APP_BASE_URL` are set and are addresses, the Hub publishes its keys, the Central token is accepted and belongs to the profile with the application's code (Central's own words are printed when it does not), Central has every permission of the code, somebody has access, and, with `--url`, that the running app turns away a visitor with no cookie (`--me-path` changes the path, default `/api/v1/me`). A running app that answers 200 is not in the Hub sign-in mode, or was not restarted after the `.env` changed. An app that names its web address differently sets `"doctor": { "appUrlEnv": "FRONTEND_URL" }` in `access.config.json` (and `"env": [...]` to list its own required lines). Every failed check prints a `Fix:` line; no secret is printed. Exit code 1 when something fails.

## Usage: conformance checks for the Access Standard (`mws-central-auth/conformance`)

Test helpers that check an app against the MWS Access Standard (`mws-data-center/docs/access-standard.md`). They return findings with the rule number (`AS-3`, `AS-6`, ...) instead of throwing, so one run lists everything. `assertConformance` throws when there is a problem; warnings never fail it. Put them in the app's normal test run (AS-15).

```ts
import { assertConformance, checkManifest, checkNoRoleNames, checkPermissionUsage, checkPresets, mergeResults, probeRoutes, trackFastifyRoutes } from "mws-central-auth/conformance";

// 1. Fastify: install the tracker before any route or plugin is registered.
const app = Fastify();
const tracker = trackFastifyRoutes(app);
await registerRoutes(app);
await app.ready();

assertConformance(mergeResults(
  // AS-3, AS-4: key format, `<app>.use`, requires, manage needs read
  checkManifest(MANIFEST, { application: "inventory" }),
  // AS-13, AS-5: starting roles only use manifest keys, carry what is needed, no two alike
  checkPresets(rolePresets, MANIFEST),
  // AS-6: every route not on the open list turns away a signed-in person with no permissions
  await probeRoutes({
    routes: tracker.routes(),
    open: ["GET /health/*", "GET /api/v1/me", "POST /api/v1/auth/logout"],
    call: async ({ method, url }) => (await app.inject({ method, url, headers: asPersonWithNoPermissions })).statusCode,
  }),
  // AS-6, AS-7: a key in the code that is not in the manifest is a typo; a manifest key nobody asks for is dead
  await checkPermissionUsage({ roots: ["src"], manifest: MANIFEST, manifestFiles: ["src/permissions.ts"] }),
  // AS-2: no role name in the logic
  await checkNoRoleNames({ roots: ["src"], roleNames: ["ADMIN", "MANAGER"], allow: [{ file: "src/labels.ts", reason: "display label" }] }),
));
```

- `probeRoutes` works with any framework: give it the routes and a `call` that sends the request as a signed-in person with no permissions. 401 or 403 passes. Any other answer means the gate let it through (a 400/413/415/422 can come from validation before the gate, so it only warns).
- `trackFastifyRoutes` is for Fastify. For other frameworks pass `routes` yourself.
- A key you registered before the standard format can be listed in `legacyKeys` of `checkManifest` so it only warns while you rename it.

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
bun run typecheck
bun test
bun run build
```

(Consumers install this package via npm as a git dependency — see
"Install" above — since that's each consuming app's own stack. `bun` here
is only for developing this repo itself.)
