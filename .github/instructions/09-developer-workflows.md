# Developer Workflows

## Common Commands

```bash
pnpm dev            # Start Vite dev server (port 3000)
pnpm build          # Build SSR output (.output/server)
pnpm start          # Run Nitro SSR server (test production builds)
pnpm preview        # Static preview (not full SSR)
pnpm lint           # Biome lint check
pnpm format         # Biome format (auto-fix)
pnpm check          # Biome type/lint combined
pnpm prepare        # Run PandaCSS codegen (on dependency changes)
```

## Before Committing

1. Run `pnpm check` to catch lint/type issues
2. Run `pnpm format` to auto-fix formatting
3. Never commit changes to `styled-system/` or `routeTree.gen.ts`
