# Cue — monorepo

Capture-aware teleprompter, organized as an npm-workspaces monorepo.

| Workspace | Package | What it is |
|---|---|---|
| `apps/desktop` | `@cue/desktop` | The Electron teleprompter app |
| `apps/admin-web` | `@cue/admin-web` | Admin dashboard — React + Vite |
| `services/api` | `@cue/api` | Backend API — Fastify |
| `packages/shared` | `@cue/shared` | Shared event/version contracts |

## Develop

```bash
npm install            # once, at the root — single lockfile, all workspaces
npm run dev:desktop    # launch the Electron app
npm run dev:api        # run the backend API (localhost:8787)
npm run dev:admin      # run the admin dashboard (Vite)
npm run dev            # api + admin together
npm test               # all workspace test suites
```

Requires Node 20 (see `.nvmrc`) and, for the API + desktop persistence, a local MongoDB on
`127.0.0.1:27017`.

See `apps/desktop/README.md` for desktop app internals (the capture-aware overlay, etc.).
