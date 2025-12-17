# Architecture & Constraints

## Core Principles

1. **Never edit generated files**: `src/routeTree.gen.ts` and `styled-system/**` are auto-generated.
2. **SSR-First**: Keep components SSR-compatible; avoid browser-only APIs during server rendering.
3. **Type Safety**: Leverage TypeScript and Zod for all runtime validation; use `z.infer<typeof Schema>` for types.
4. **DDD & Bounded Contexts**: Organize features as isolated modules under `src/modules/{client,server}` with explicit boundaries.
5. **Styling at Build Time**: All styles must be defined via PandaCSS tokens/recipes; generate utilities, never modify `styled-system/`.

## File Structure

```
src/
  routes/             # File-based routing (TanStack Router)
    __root.tsx        # Root shell with hydration & layout
    index.tsx         # Home page example
  modules/
    {feature}/
        shared/          # Shared code between client & server
            schema/       # Zod schemas for validation
        client/           # Client-only feature modules
            components/   # Feature UI components (use styled-system & ui/*)
            utils/        # Pure helpers
        server/           # Server-only implementations (never client-imported)
            service/      # Domain use-cases & application logic
            repository/   # IO boundaries (API calls, storage)
            utils/        # Pure helpers
  components/
    ui/               # Reusable UI primitives (Ark UI wrappers + PandaCSS)
  theme/              # Design tokens & recipes (PandaCSS config source)
  env.ts              # Validated environment variables
  router.tsx          # Router instance
styled-system/        # ⚠️ GENERATED - Never edit
panda.config.ts       # PandaCSS configuration (design tokens, recipes)
vite.config.ts        # Vite + TanStack Start + Nitro setup
```
