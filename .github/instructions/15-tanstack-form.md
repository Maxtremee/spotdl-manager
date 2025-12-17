# TanStack Form with Solid.js Adapter

## Overview

TanStack Form is a headless, type-safe form state management library that works seamlessly with Solid.js. It provides:

- **Headless design**: No UI components—you control rendering completely
- **Framework-agnostic validation**: Works with Zod, custom validators, or both
- **Fine-grained reactivity**: Integrates perfectly with Solid.js signals
- **Array field support**: Built-in array/list management with add/remove/reorder
- **Type safety**: Full TypeScript inference from schema to form state

---

## Core Concepts

### Creating a Form

Use `createForm()` to initialize a form instance:

```typescript
import { createForm } from '@tanstack/solid-form'

function MyForm() {
  const form = createForm(() => ({
    defaultValues: {
      email: '',
      password: '',
    },
    onSubmit: async ({ value }) => {
      // value is fully typed and validated
      const response = await submitForm(value)
      return response
    },
  }))

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        e.stopPropagation()
        form.handleSubmit()
      }}
    >
      {/* Form fields */}
    </form>
  )
}
```

### Declaring Fields

Use `form.Field` component to declare individual fields:

```typescript
<form.Field
  name="email"
  children={(field) => (
    <div>
      <label for={field().name}>Email</label>
      <input
        id={field().name}
        name={field().name}
        value={field().state.value}
        onBlur={field().handleBlur}
        onInput={(e) => field().handleChange(e.target.value)}
      />
    </div>
  )}
/>
```

### Accessing Form State

Use `form.useStore()` to subscribe to form state:

```typescript
function FormStatus() {
  const formState = form.useStore((state) => state)

  return (
    <div>
      <p>Errors: {Object.keys(formState().errorMap).length}</p>
      <p>Is Valid: {formState().isValidating ? 'Validating...' : 'Done'}</p>
    </div>
  )
}
```

---

## Validation Patterns

### Zod Schema Validation

Define validation in the field using `parseValueWithSchema`:

```typescript
import { z } from 'zod'

const EmailSchema = z.string().email('Invalid email')
const PasswordSchema = z.string().min(8, 'Password must be 8+ characters')

<form.Field
  name="email"
  validators={{
    onChange: ({ value, fieldApi }) => {
      const errors = fieldApi.parseValueWithSchema(EmailSchema)
      return errors // Returns validation errors or undefined
    },
  }}
  children={(field) => (
    <div>
      <input
        value={field().state.value}
        onInput={(e) => field().handleChange(e.target.value)}
      />
      {field().state.meta.errors.length > 0 && (
        <em role="alert">{field().state.meta.errors[0]}</em>
      )}
    </div>
  )}
/>
```

### Async Validation (Debounced)

Validate on change with async debouncing (e.g., check if email exists):

```typescript
<form.Field
  name="email"
  validators={{
    onChangeAsync: async ({ value }) => {
      await new Promise((resolve) => setTimeout(resolve, 500)) // Debounce
      const emailExists = await checkEmailExists(value)
      return emailExists ? 'Email already in use' : undefined
    },
  }}
  asyncDebounceMs={500}
  children={(field) => (
    <div>
      <input
        value={field().state.value}
        onInput={(e) => field().handleChange(e.target.value)}
      />
      {field().state.meta.isTouched && field().state.meta.errors.length > 0 && (
        <em>{field().state.meta.errors[0]}</em>
      )}
    </div>
  )}
/>
```

### Combining Sync and Async Validation

Validate on multiple events (onChange, onBlur, onBlurAsync):

```typescript
<form.Field
  name="age"
  validators={{
    onChange: ({ value }) =>
      value < 0 ? 'Age cannot be negative' : undefined,
    onBlur: ({ value }) =>
      value < 18 ? 'Must be 18 or older' : undefined,
    onBlurAsync: async ({ value }) => {
      // Server-side validation after blur
      const isValid = await validateAgeWithServer(value)
      return isValid ? undefined : 'Age validation failed on server'
    },
  }}
  asyncDebounceMs={300}
  children={(field) => (
    <div>
      <input
        type="number"
        value={field().state.value}
        onInput={(e) => field().handleChange(e.target.valueAsNumber)}
        onBlur={field().handleBlur}
      />
      {field().state.meta.errors.length > 0 && (
        <em>{field().state.meta.errors.join(', ')}</em>
      )}
    </div>
  )}
/>
```

### Form-Level Validation

Validate across multiple fields:

```typescript
const form = createForm(() => ({
  defaultValues: { password: '', confirmPassword: '' },
  validators: {
    onChangeAsync: async ({ value }) => {
      // Validate password match
      if (value.password !== value.confirmPassword) {
        return { confirmPassword: 'Passwords do not match' }
      }
      return undefined
    },
  },
  onSubmit: ({ value }) => {
    // Handle submission
  },
}))
```

---

## Array Fields

### Basic Array Field

Use `form.Field` with `mode="array"` for dynamic lists:

```typescript
<form.Field
  name="hobbies"
  mode="array"
  children={(hobbiesField) => (
    <div>
      <h3>Hobbies</h3>
      <Show
        when={hobbiesField().state.value.length > 0}
        fallback={<p>No hobbies yet</p>}
      >
        {/* IMPORTANT: Use Index, not For! */}
        <Index each={hobbiesField().state.value}>
          {(_, i) => (
            <div>
              <form.Field
                name={`hobbies[${i}].name`}
                children={(field) => (
                  <input
                    value={field().state.value}
                    onInput={(e) => field().handleChange(e.target.value)}
                  />
                )}
              />
              <button
                type="button"
                onClick={() => hobbiesField().removeValue(i)}
              >
                Remove
              </button>
            </div>
          )}
        </Index>
      </Show>
      <button
        type="button"
        onClick={() =>
          hobbiesField().pushValue({ name: '', yearsOfExperience: 0 })
        }
      >
        Add Hobby
      </button>
    </div>
  )}
/>
```

### Array Operations

```typescript
// Access the field API
const form = createForm(() => ({
  defaultValues: { items: [] },
}))

const itemsField = form.Field({
  name: 'items',
  mode: 'array',
  children: (field) => field,
})

// Operations on array fields
itemsField().pushValue({ name: 'New Item' })          // Add to end
itemsField().insertValue(1, { name: 'At Index' })     // Insert at index
itemsField().removeValue(0)                           // Remove by index
itemsField().replaceValue(0, { name: 'Replaced' })    // Replace at index
itemsField().swapFieldValues(0, 1)                    // Swap two items
itemsField().clearFieldValues()                       // Clear all items
```

### Why Use `Index` Not `For`?

```typescript
// ❌ WRONG - For loops cause issues with array reordering
<For each={field().state.value}>
  {(_, i) => (/* ... */)}
</For>

// ✅ CORRECT - Index preserves array identity
<Index each={field().state.value}>
  {(_, i) => (/* ... */)}
</Index>
```

---

## Accessing Form State

### Using `useStore` Hook

Subscribe to specific form state:

```typescript
function FormInfo() {
  const form = /* ... */

  // Subscribe to entire state
  const formState = form.useStore()

  // Subscribe to specific properties
  const errors = form.useStore((state) => state.errorMap)
  const isSubmitting = form.useStore((state) => state.isSubmitting)

  return (
    <div>
      <p>Errors: {Object.keys(errors().onChange || {}).length}</p>
      <p>{isSubmitting() ? 'Submitting...' : 'Ready'}</p>
    </div>
  )
}
```

### Using `Subscribe` Component

Alternative to `useStore` for complex subscriptions:

```typescript
<form.Subscribe
  selector={(state) => [
    state.canSubmit,
    state.isSubmitting,
    state.errorMap,
  ]}
  children={(canSubmit, isSubmitting, errorMap) => (
    <button type="submit" disabled={!canSubmit() || isSubmitting()}>
      {isSubmitting() ? 'Submitting...' : 'Submit'}
    </button>
  )}
/>
```

---

## Error Handling

### Field-Level Errors

Access errors by validation phase:

```typescript
<form.Field
  name="email"
  validators={{
    onChange: ({ value }) =>
      value.length === 0 ? 'Required' : undefined,
    onBlur: ({ value }) =>
      !value.includes('@') ? 'Invalid email' : undefined,
  }}
  children={(field) => (
    <div>
      <input value={field().state.value} />
      
      {/* Show onChange errors */}
      {field().state.meta.errorMap.onChange && (
        <span>{field().state.meta.errorMap.onChange}</span>
      )}
      
      {/* Show onBlur errors */}
      {field().state.meta.errorMap.onBlur && (
        <span>{field().state.meta.errorMap.onBlur}</span>
      )}
      
      {/* Show all errors (shorthand) */}
      {field().state.meta.errors.length > 0 && (
        <em>{field().state.meta.errors.join(', ')}</em>
      )}
    </div>
  )}
/>
```

### Form-Level Error Map

Access form errors by field:

```typescript
function ErrorSummary() {
  const form = /* ... */
  const errors = form.useStore((state) => state.errorMap)

  return (
    <div>
      {Object.entries(errors().onChange || {}).map(([field, error]) => (
        <p key={field}>
          {field}: {error}
        </p>
      ))}
    </div>
  )
}
```

---

## Integration with Server Functions

Use with TanStack Start server functions for mutations:

```typescript
const submitProfileForm = createServerFn({ method: 'POST' })
  .inputValidator((data) => ProfileFormSchema.parse(data))
  .handler(async ({ data }) => {
    // Server-only validation and persistence
    const result = await db.profiles.update(data)
    return result
  })

function ProfileForm() {
  const form = createForm(() => ({
    defaultValues: {
      name: '',
      email: '',
      bio: '',
    },
    onSubmit: async ({ value }) => {
      try {
        const submitFn = useServerFn(submitProfileForm)
        const result = await submitFn(value)
        // Handle success
      } catch (error) {
        // Handle error
      }
    },
  }))

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        form.handleSubmit()
      }}
    >
      {/* Fields */}
    </form>
  )
}
```

---

## Best Practices

### 1. **Always Use Full Type Inference**

```typescript
// ✅ GOOD - Let TypeScript infer types
const form = createForm(() => ({
  defaultValues: {
    email: '',
    age: 0,
    preferences: { theme: 'light' as const },
  },
}))

// Then field names are type-checked:
// form.Field name="email" ✅
// form.Field name="notAField" ❌ Type error
```

### 2. **Validate with Zod in Features**

Organize validation schemas with features:

```
src/modules/client/auth/
  schema/
    auth.ts
      ├─ LoginSchema
      ├─ RegisterSchema
      └─ ProfileSchema
  components/
    LoginForm.tsx
    RegisterForm.tsx
```

```typescript
// src/modules/client/auth/schema/auth.ts
import { z } from 'zod'

export const LoginSchema = z.object({
  email: z.string().email('Invalid email'),
  password: z.string().min(8, 'Password must be 8+ characters'),
})

export type LoginFormData = z.infer<typeof LoginSchema>
```

```typescript
// src/modules/client/auth/components/LoginForm.tsx
import { LoginSchema } from '../schema/auth'

function LoginForm() {
  const form = createForm(() => ({
    defaultValues: {
      email: '',
      password: '',
    },
    validators: {
      onChange: ({ value, fieldApi }) => {
        return fieldApi.parseValueWithSchema(LoginSchema)
      },
    },
  }))
}
```

### 3. **Debounce Async Validators**

Always set `asyncDebounceMs` for async validators to avoid excessive server calls:

```typescript
<form.Field
  name="username"
  validators={{
    onChangeAsync: async ({ value }) => {
      const exists = await checkUsernameExists(value)
      return exists ? 'Username taken' : undefined
    },
  }}
  asyncDebounceMs={500} // Wait 500ms after user stops typing
  children={(field) => (
    /* ... */
  )}
/>
```

### 4. **Use `Index` for Array Fields**

Never use `For` with array fields—use `Index` to preserve identity:

```typescript
// ❌ WRONG
<For each={field().state.value}>
  {(item, i) => /* ... */}
</For>

// ✅ CORRECT
<Index each={field().state.value}>
  {(_, i) => /* ... */}
</Index>
```

### 5. **Separate Complex Forms into Sub-Components**

Keep forms readable by splitting into smaller field components:

```typescript
function ComplexForm() {
  const form = createForm(() => ({
    defaultValues: {
      personal: { name: '', email: '' },
      address: { street: '', city: '' },
      preferences: { theme: '', notifications: true },
    },
  }))

  return (
    <form>
      <PersonalFieldGroup form={form} />
      <AddressFieldGroup form={form} />
      <PreferencesFieldGroup form={form} />
    </form>
  )
}

function PersonalFieldGroup(props) {
  return (
    <>
      <props.form.Field name="personal.name" children={/* ... */} />
      <props.form.Field name="personal.email" children={/* ... */} />
    </>
  )
}
```

### 6. **Handle Async Submission States**

Use form state to manage submission UI:

```typescript
<form.Subscribe
  selector={(state) => [state.isSubmitting, state.canSubmit]}
  children={(isSubmitting, canSubmit) => (
    <button type="submit" disabled={!canSubmit() || isSubmitting()}>
      {isSubmitting() ? (
        <>
          <Spinner /> Submitting...
        </>
      ) : (
        'Submit'
      )}
    </button>
  )}
/>
```

### 7. **Reset Forms After Success**

Reset form state after successful submission:

```typescript
const form = createForm(() => ({
  defaultValues: { /* ... */ },
  onSubmit: async ({ value }) => {
    const response = await api.submit(value)
    if (response.ok) {
      form.reset()
    }
  },
}))
```

### 8. **Validate on Specific Events Only**

Use appropriate validators for each field to minimize validation runs:

```typescript
<form.Field
  name="email"
  validators={{
    onChange: ({ value }) => {
      // Quick syntax check on every change
      return !value.includes('@') ? 'Invalid format' : undefined
    },
    onBlur: ({ value }) => {
      // Detailed check on blur
      return value.length < 5 ? 'Too short' : undefined
    },
    onBlurAsync: async ({ value }) => {
      // Server check only on blur (expensive)
      const exists = await checkEmailExists(value)
      return exists ? 'Email exists' : undefined
    },
  }}
  children={/* ... */}
/>
```

---

## Summary Rules

1. ✅ **Use `createForm()` for initialization** with typed `defaultValues`
2. ✅ **Declare fields with `form.Field`** using child function pattern
3. ✅ **Validate with Zod schemas** via `fieldApi.parseValueWithSchema()`
4. ✅ **Use async validators with debounce** (`asyncDebounceMs`)
5. ✅ **Use `Index` not `For` for array fields** to preserve identity
6. ✅ **Organize schemas under `src/modules/{feature}/schema/`**
7. ✅ **Handle async submission with `form.useStore()`**
8. ✅ **Separate complex forms into sub-components**
9. ✅ **Never assume loaders are server-only** when using forms
10. ✅ **Call server functions via `createServerFn`** for mutations
