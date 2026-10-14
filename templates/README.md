# Starter apps

Small apps that already work with the Hub through `mws-central-auth`. Copy one, rename it, and build your app on top.

Pick by where the app lives:

| Folder | For | Stack | Verified by |
|---|---|---|---|
| `express/` | An app on the Hub's parent domain (shared session). No sign-in or sign-out code. | Express, JavaScript | `npm test` (10 end-to-end tests against a pretend Hub and Central) |
| `nextjs/` | The same, in Next.js | Next.js App Router, TypeScript | `npm run type-check`, `npm run build`, and a manual run against a pretend Hub and Central |
| `express-relay/`, `nextjs-relay/` | An app that is NOT on the parent domain. Signs in through the Hub's code and relay token and has its own session and logout. | as above | `npm test` / `npm run type-check`, `npm run build` |

## The shared-session starters (`express/`, `nextjs/`)

The Hub keeps a short access token in a cookie on the parent domain (see the Hub README). The app:

1. reads the cookie and checks it against the Hub's keys (`createHubSession`),
2. gets the person's role and permissions in this app from Central (the entitlement lookup, kept for a minute),
3. sends a request without a session to the Hub, which gives one back if the person still has it (`/auth/restore`) or shows its front page,
4. keeps the token fresh while a page is open (`keepFresh`).

There is no sign-in route, no session store and no logout: the page shows a "Back to the Hub" link, and signing out of the Hub signs the person out of every app. The only app-specific pieces are `access.js` / `lib/access.ts` (the Central lookup) and the routes you add with `requireUser('permission.key')`.

### Set up a new app

1. In Central (Application Access, Add Application): give the app an id, name and address. The Sign-In Way is **Shared Hub Session** by default, which is what these starters are; its `.env` block is short (no Hub secret). The launch address stays `…/auth/sso`, which the starters answer by sending the browser to the page. Add its roles (each needs at least one permission) and the groups that get them. Press Connect to get the `.env` block, and publish it to the Hub when it is ready.
2. Copy a template folder and give the app its name in `package.json`.
3. Copy `.env.example` to `.env`, paste the block from Central, and set `APP_PUBLIC_URL`.
4. `npm install`, then `npm run dev` (Next.js) or `npm start` (Express). The Hub card opens the app signed in.

`zod` (version 4 or newer) must be installed next to the package; the templates already list it. In production the Hub needs `HUB_COOKIE_DOMAIN` set to the parent domain, and the app must be served from a host under it.

## The relay starters (`express-relay/`, `nextjs-relay/`)

### What you get

The four routes every app has, wired to `createHubSso`:

| Route | Does |
|---|---|
| `GET /auth/hub` | Starts a sign-in this app owns (Hub with a state, and a cookie that remembers it) |
| `GET /auth/sso` | Receives the Hub's code, exchanges and verifies it, checks the entitlement, starts the session |
| `GET /auth/logout` | Ends this session and sends the browser, in the same tab, to the Hub, which ends the other apps' sessions and shows its front page |
| `POST /auth/revoke-session` | The Hub ends sessions here (someone signed out elsewhere, or the application was retired) |

Plus a session that dies when the Hub says so, `/api/me`, a page that goes to the Hub when there is no session, and the browser watcher (`watchSession`) that makes a sign-out elsewhere show up when the tab is looked at again.

### Set up a new app

1. In Central (Application Access, Add Application): give the app an id, name and address. Add its roles (each needs at least one permission) and the groups that get them. Press Connect to get the `.env` block, and publish it to the Hub when it is ready.
2. Copy a template folder. In `package.json` give the app its name.
3. Copy `.env.example` to `.env`, paste the block from Central, and set `SESSION_SECRET`.
4. `npm install`, then `npm run dev` (Next.js) or `npm start` (Express). The Hub card opens the app signed in.

### What you still own

- **Users and sessions.** `users.js` / `lib/users.ts` keep people in memory so the starter runs on its own. Replace them with your database, keeping `upsertFromRelay`, `findById` and `endSessions`.
- **Permissions.** Decide from `user.permissions` (the Central permission keys), not from the role name. `requireSession('things.read')` / `requireUser('things.read')` do that.
- **More than one instance.** The replay store for relay tokens is in memory; give `verifyRelayToken` a shared one (see the package README).

`zod` (version 4 or newer) must be installed next to the package; the templates already list it.
