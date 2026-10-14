# Graph Report - mws-central-auth  (2026-09-23)

## Corpus Check
- Corpus is ~3,890 words - fits in a single context window. You may not need a graph.

## Summary
- 177 nodes · 264 edges · 8 communities
- Extraction: 99% EXTRACTED · 1% INFERRED · 0% AMBIGUOUS · INFERRED: 2 edges (avg confidence: 0.85)
- Token cost: 0 input · 0 output

## Community Hubs (Navigation)
- Community 0
- Community 1
- Community 2
- Community 3
- Community 4
- Community 5
- Community 6
- Community 7

## God Nodes (most connected - your core abstractions)
1. `CentralDataClient` - 15 edges
2. `compilerOptions` - 14 edges
3. `ReplayStore` - 8 edges
4. `verifyRelayToken` - 8 edges
5. `InMemoryReplayStore` - 7 edges
6. `verifyRelayToken()` - 7 edges
7. `Paging` - 6 edges
8. `StudentProfile` - 6 edges
9. `EmployeeProfile` - 6 edges
10. `sub as Central's stable Person.id` - 6 edges

## Surprising Connections (you probably didn't know these)
- `PagedEnvelope` --references--> `Paging`  [EXTRACTED]
  src/data-client/client.ts → src/data-client/types.ts
- `verifyRelayToken()` --calls--> `importPublicKeyFromJwks()`  [EXTRACTED]
  src/server/verify.ts → src/server/jwks.ts
- `verifyRelayToken()` --calls--> `importPublicKeyFromPem()`  [EXTRACTED]
  src/server/verify.ts → src/server/jwks.ts
- `InMemoryReplayStore` --implements--> `ReplayStore`  [EXTRACTED]
  src/server/replay-store.ts → src/server/types.ts
- `VerifyRelayTokenOptions` --references--> `ReplayStore`  [EXTRACTED]
  src/server/verify.ts → src/server/types.ts

## Import Cycles
- None detected.

## Hyperedges (group relationships)
- **Rationale for keying on sub (Person.id) instead of email** — readme_person_id_sub_claim, readme_email_display_attribute, readme_employeevalidation_update [EXTRACTED 1.00]
- **Two token verification key strategies** — readme_verifyrelaytoken, readme_jwks_lookup, readme_publickeypem_fixed_key [EXTRACTED 1.00]
- **SSO relay token exchange flow (Hub launch, code exchange, verification)** — readme_apps_launch_endpoint, readme_sso_exchange_endpoint, readme_verifyrelaytoken, readme_relaytokenverificationerror [EXTRACTED 1.00]

## Communities (8 total, 0 thin omitted)

### Community 0 - "Community 0"
Cohesion: 0.11
Nodes (24): ref_node_crypto, ref_zod, HubInternalRequestVerificationError, HubInternalRevocationPayload, hubInternalRevocationPayloadSchema, parseHubRevocationPayload(), verifyHubInternalSecret(), cache (+16 more)

### Community 1 - "Community 1"
Cohesion: 0.16
Nodes (15): CentralDataClient, ErrorEnvelope, PagedEnvelope, SuccessEnvelope, CentralApiError, CentralDataClientOptions, ClassProfile, ClassTeacherAssignment (+7 more)

### Community 2 - "Community 2"
Cohesion: 0.08
Nodes (29): /apps/:appId/launch (Hub), bun (local dev tooling), Central (identity source of truth), email as display/contact attribute (not a key), /employees/lookup (Central), EmployeeValidation.UPDATE (Central), Hub (mws-hub identity relay), HUB_SSO_PUBLIC_KEY env var pattern (+21 more)

### Community 3 - "Community 3"
Cohesion: 0.08
Nodes (25): framer-motion, dependencies, framer-motion, description, files, license, main, module (+17 more)

### Community 4 - "Community 4"
Cohesion: 0.10
Nodes (19): DOM, ES2020, node, src, compilerOptions, declaration, esModuleInterop, ignoreDeprecations (+11 more)

### Community 5 - "Community 5"
Cohesion: 0.13
Nodes (16): devDependencies, react, tsup, @types/node, @types/react, typescript, zod, peerDependencies (+8 more)

### Community 6 - "Community 6"
Cohesion: 0.29
Nodes (8): ref_framer_motion, ref_react, buildStyles(), DEFAULT_THEME, StatusMessageAction, StatusMessagePage(), StatusMessagePageProps, StatusMessageTheme

### Community 7 - "Community 7"
Cohesion: 0.22
Nodes (9): import, require, types, exports, ./data-client, ./server, import, require (+1 more)

## Knowledge Gaps
- **60 isolated node(s):** `name`, `version`, `description`, `type`, `main` (+55 more)
  These have ≤1 connection - possible missing edges or undocumented components. (Counts symbols only; 67 node(s) total have ≤1 connection when file, concept and rationale nodes are included.)

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `devDependencies` connect `Community 5` to `Community 3`?**
  _High betweenness centrality (0.031) - this node is a cross-community bridge._
- **Why does `exports` connect `Community 7` to `Community 3`?**
  _High betweenness centrality (0.023) - this node is a cross-community bridge._
- **What connects `name`, `version`, `description` to the rest of the system?**
  _60 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Community 0` be split into smaller, more focused modules?**
  _Cohesion score 0.11428571428571428 - nodes in this community are weakly interconnected._
- **Should `Community 2` be split into smaller, more focused modules?**
  _Cohesion score 0.08374384236453201 - nodes in this community are weakly interconnected._
- **Should `Community 3` be split into smaller, more focused modules?**
  _Cohesion score 0.07692307692307693 - nodes in this community are weakly interconnected._
- **Should `Community 4` be split into smaller, more focused modules?**
  _Cohesion score 0.1 - nodes in this community are weakly interconnected._