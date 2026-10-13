# Starter apps

Two small apps that already sign in and out through the Hub with `mws-central-auth`. Copy one, rename it, and build your app on top.

| Folder | Stack | Verified by |
|---|---|---|
| `express/` | Express, plain JavaScript | `npm test` (8 end-to-end tests against a pretend Hub) |
| `nextjs/` | Next.js App Router, TypeScript | `npm run type-check`, `npm run build`, and a manual run against a pretend Hub |

## What you get

The four routes every app has, wired to `createHubSso`:

| Route | Does |
|---|---|
| `GET /auth/hub` | Starts a sign-in this app owns (Hub with a state, and a cookie that remembers it) |
| `GET /auth/sso` | Receives the Hub's code, exchanges and verifies it, checks the entitlement, starts the session |
| `GET /auth/logout` | Ends this session and sends the browser, in the same tab, to the Hub, which ends the other apps' sessions and shows its front page |
| `POST /auth/revoke-session` | The Hub ends sessions here (someone signed out elsewhere, or the application was retired) |

Plus a session that dies when the Hub says so, `/api/me`, a page that goes to the Hub when there is no session, and the browser watcher (`watchSession`) that makes a sign-out elsewhere show up when the tab is looked at again.

## Set up a new app

1. In Central (Application Access, Add Application): give the app an id, name and address. Add its roles (each needs at least one permission) and the groups that get them. Press Connect to get the `.env` block, and publish it to the Hub when it is ready.
2. Copy a template folder. In `package.json` give the app its name.
3. Copy `.env.example` to `.env`, paste the block from Central, and set `SESSION_SECRET`.
4. `npm install`, then `npm run dev` (Next.js) or `npm start` (Express). The Hub card opens the app signed in.

## What you still own

- **Users and sessions.** `users.js` / `lib/users.ts` keep people in memory so the starter runs on its own. Replace them with your database, keeping `upsertFromRelay`, `findById` and `endSessions`.
- **Permissions.** Decide from `user.permissions` (the Central permission keys), not from the role name. `requireSession('things.read')` / `requireUser('things.read')` do that.
- **More than one instance.** The replay store for relay tokens is in memory; give `verifyRelayToken` a shared one (see the package README).

`zod` (version 4 or newer) must be installed next to the package; the templates already list it.
