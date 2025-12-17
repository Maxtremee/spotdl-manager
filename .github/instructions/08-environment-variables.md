# Environment Variables

## Client Variables (Prefixed with `VITE_`)

1. Define in `src/env.ts` using `@t3-oss/env-core`:

   ```typescript
   import { createEnv } from '@t3-oss/env-core'
   
   export const env = createEnv({
     client: {
       VITE_API_URL: z.string().url(),
     },
     runtimeEnv: import.meta.env,
   })
   ```

2. Access via `import.meta.env.VITE_API_URL` only (not `process.env`)

3. All client-side env vars must be validated and typed

## Server Variables

- Define in server functions or `.env` for Nitro
- Use process.env in server-only code under `src/modules/server/`
