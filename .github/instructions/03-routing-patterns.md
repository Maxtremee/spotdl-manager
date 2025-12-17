# Routing Patterns (TanStack Router + File-Based)

## Creating a New Route

1. Create a file under `src/routes/` (e.g., `src/routes/about.tsx`)
2. Use `createFileRoute()` and export `Route`:

```typescript
import { createFileRoute } from '@tanstack/solid-router'

export const Route = createFileRoute('/about')({
  component: About,
})

function About() {
  return <div>About Page</div>
}
```

## Root Layout (`__root.tsx`)

- Declared via `createRootRouteWithContext()` with `shellComponent` and `head`
- Must include hydration essentials: `HydrationScript`, `HeadContent`, `Scripts`, `Outlet`
- Keep stylesheet link via `styles.css?url`
- Only modify the root shell if changing global layout/hydration; rarely needed

## Router Updates

- File-based routing auto-generates `src/routeTree.gen.ts`—never edit this file manually
- Changes to `src/router.tsx` or route files trigger regeneration
