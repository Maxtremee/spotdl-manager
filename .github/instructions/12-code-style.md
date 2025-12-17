# Code Style & Best Practices

## TypeScript & Naming

- Prefer `.tsx` for components, `.ts` for utilities/services
- Use PascalCase for components and types, camelCase for functions/variables
- Export types explicitly: `export type MyType = z.infer<typeof MySchema>`
- No `any`; always type strictly

## File Organization

- Group related functions/types in single modules
- Use `index.ts` as public API for feature modules
- Keep files under 300 lines; split if larger

## Testing & Validation

- Validate all external inputs with Zod (API responses, form data, env vars)
- Use refinements and discriminated unions for complex validations
- Prefer pure functions in `utils/` for testability

## Solid.js-Specific

- Use `<Show>`, `<For>`, `<Suspense>` for conditional and list rendering
- Prefer reactive signals over effects when possible
- Avoid `createEffect` for side effects in components; use server functions or dedicated effect boundaries
