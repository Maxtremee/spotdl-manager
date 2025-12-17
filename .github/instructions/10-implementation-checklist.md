# Implementation Checklist

When implementing features, follow this checklist:

- [ ] **Routing**: Create new routes under `src/routes/` using `createFileRoute()`
- [ ] **Validation**: Define schemas in `src/modules/{feature}/schema/` with Zod
- [ ] **Service Layer**: Implement business logic in `service/`; never call `repository` from UI
- [ ] **Repository Layer**: Define IO boundaries; keep adapters near implementation
- [ ] **UI Components**: Compose from `src/components/ui/` and use PandaCSS utilities
- [ ] **Styling**: Use `css()` from `styled-system/css` and tokens from `src/theme/`
- [ ] **Types**: Export types via `z.infer<typeof Schema>` for shared inference
- [ ] **SSR Compatibility**: Wrap async UI with `<Suspense>`; avoid browser-only APIs in components
- [ ] **Server Boundaries**: Never import server code into client modules
- [ ] **Linting**: Run `pnpm check` and `pnpm format` before committing
- [ ] **Environment**: Validate all env vars in `src/env.ts` with Zod
