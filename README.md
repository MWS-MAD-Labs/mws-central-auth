# mws-central-auth-ui

Reusable status/error page components for MWS apps that integrate with the
central database (`mws-data-center`). Scoped for now to auth-failure pages
(e.g. "your account isn't registered centrally") — more components can be
added here later as other apps need them.

Consumed as a git dependency, not published to npm.

## Install

```json
"dependencies": {
  "mws-central-auth-ui": "git+https://github.com/MWS-MAD-Labs/mws-central-auth-ui.git#v0.1.1"
}
```

`npm install` clones the tag and runs this package's `prepare` script
(`tsup` build) automatically — no manual build step needed on the consumer
side.

## Usage

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
