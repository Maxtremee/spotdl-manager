# Common Gotchas & Solutions

| Issue | Solution |
|-------|----------|
| Hydration mismatch in browser | Wrap async components in `<Suspense>`; ensure server and client render identically |
| Generated files keep reverting | Never edit `styled-system/` or `routeTree.gen.ts`; regenerate via `pnpm prepare` or routing file changes |
| PandaCSS types not available | Run `pnpm prepare` to trigger Panda codegen; ensure `panda.config.ts` changes are saved |
| Styles not applying | Verify `css()` import is from `styled-system/css`; check token names in `panda.config.ts` |
| Server code leaking to client | Use explicit server functions or `src/modules/server/`; check imports in client modules |
| Routes not updating | File-based routing auto-detects changes; check `src/routeTree.gen.ts` was regenerated |
| Type errors in server functions | Validate inputs with Zod; export types via `z.infer<typeof Schema>` for network boundaries |
| Env var undefined on client | Ensure prefix is `VITE_` and validated in `src/env.ts`; access via `import.meta.env` only |
