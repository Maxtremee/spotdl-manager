# Validation with Zod

## Schema Structure

1. **Define schemas in `src/modules/{feature}/schema/`**:

   ```typescript
   import { z } from 'zod'
   
   export const CreateUserSchema = z.object({
     email: z.string().email(),
     name: z.string().min(1),
   })
   
   export type CreateUserInput = z.infer<typeof CreateUserSchema>
   export type CreateUserOutput = z.infer<typeof CreateUserSchema> & { id: string }
   ```

2. **Use `z.infer<typeof Schema>`** for type inference; never duplicate types

3. **Server functions validate inputs**:

   ```typescript
   export async function createUser(input: unknown) {
     const data = CreateUserSchema.parse(input) // throws on invalid
     // ... create user
   }
   ```

4. **Discriminated unions and refinements** for complex validations:

   ```typescript
   export const AuthSchema = z.discriminatedUnion('type', [
     z.object({ type: z.literal('email'), email: z.string().email() }),
     z.object({ type: z.literal('sso'), provider: z.string() }),
   ])
   ```
