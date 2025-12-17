# SSR Conventions

## Solid.js SSR Compatibility

1. **Async Components & Suspense**
   - Wrap async UI with `<Suspense>` to avoid hydration mismatches
   - Ensure server can prerender; avoid client-only data loading in components

2. **Hydration Integrity**
   - Never import `HydrationScript`, `HeadContent`, `Scripts` elsewhere; they belong in root shell only
   - Keep the HTML skeleton consistent between server and client renders

3. **Browser-Only APIs**
   - Detect client-side context (use `createEffect` or similar Solid APIs)
   - Store geolocation, localStorage, or window references in server functions or async boundaries

## Server Functions & Data Loading

- Use TanStack Start's server functions for data fetching and mutations
- Define schemas in feature `schema/` folders; validate inputs with Zod
- Return validated, typed responses to maintain type safety across the network boundary
