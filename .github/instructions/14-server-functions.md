# Server Functions & Route Loaders

## Overview

TanStack Start server functions are a core mechanism for executing code on the server and calling it isomorphically from anywhere in your application. They are **always required** for server-only operations like accessing environment variables, database connections, or sensitive API keys.

The route loader pattern is the recommended approach for data fetching: define a `loader` in your route definition that executes server-side before the component renders, then access the loaded data in your component using `Route.useLoaderData()`.

---

## Critical: Server-Only Operations Must Use `createServerFn`

### ⚠️ The Core Rule

**Route loaders execute on BOTH server and client during hydration.** Therefore:

- ❌ **Never assume a route loader is server-only**
- ✅ **Always wrap server-only logic in `createServerFn`**

### Example: Protecting Secrets

```typescript
// ❌ WRONG - Exposes SECRET to client bundle!
export const Route = createFileRoute('/users')({
  loader: async () => {
    // This runs on BOTH server and client!
    const secret = process.env.SECRET
    return fetch(`/api/users?key=${secret}`)
  },
})

// ✅ CORRECT - Server function keeps SECRET safe
const getUsersSecurely = createServerFn().handler(async () => {
  // This runs ONLY on the server
  const secret = process.env.SECRET
  return fetch(`/api/users?key=${secret}`)
})

export const Route = createFileRoute('/users')({
  loader: () => getUsersSecurely(), // Isomorphic call
})
```

---

## Creating Server Functions

### Basic Syntax with `createServerFn`

```typescript
import { createServerFn } from '@tanstack/solid-start'

// GET request (default - for data fetching)
export const getPostById = createServerFn()
  .handler(async () => {
    // Server-only code
    return { id: 1, title: 'Hello' }
  })

// POST request (for mutations)
export const createPost = createServerFn({ method: 'POST' })
  .handler(async () => {
    // Server-only code
    return { success: true }
  })
```

### With Input Validation

```typescript
import { createServerFn } from '@tanstack/solid-start'
import { z } from 'zod'

const GetPostSchema = z.object({
  id: z.string(),
})

export const getPost = createServerFn()
  .inputValidator((data) => GetPostSchema.parse(data))
  .handler(async ({ data }) => {
    // data is typed as z.infer<typeof GetPostSchema>
    const post = await db.posts.findUnique({ where: { id: data.id } })

    if (!post) {
      throw notFound()
    }

    return post
  })
```

---

## Route Loader Pattern

### Standard Data Loading

Use route loaders to fetch data server-side before rendering:

```typescript
// src/routes/posts.tsx
import { createFileRoute } from '@tanstack/solid-router'

const getPosts = createServerFn().handler(async () => {
  // Fetches on server during SSR
  const posts = await db.posts.findMany()
  return posts
})

export const Route = createFileRoute('/posts')({
  loader: () => getPosts(),
  component: PostsList,
})

function PostsList() {
  // Data is available immediately (prerendered on server)
  const posts = Route.useLoaderData()

  return (
    <div>
      {posts.map((post) => (
        <article key={post.id}>{post.title}</article>
      ))}
    </div>
  )
}
```

### Dynamic Routes with Parameters

```typescript
// src/routes/posts/$postId.tsx
import { createFileRoute } from '@tanstack/solid-router'

const getPost = createServerFn()
  .inputValidator((data: { id: string }) => data)
  .handler(async ({ data }) => {
    const post = await db.posts.findUnique({ where: { id: data.id } })

    if (!post) {
      throw notFound()
    }

    return post
  })

export const Route = createFileRoute('/posts/$postId')({
  loader: async ({ params }) => {
    return getPost({ id: params.postId })
  },
  component: PostDetail,
})

function PostDetail() {
  const post = Route.useLoaderData()
  return <div>{post.title}</div>
}
```

### With Error Handling

```typescript
export const Route = createFileRoute('/dashboard')({
  loader: async () => {
    try {
      const data = await fetchDashboardData()
      return { data, error: null }
    } catch (error) {
      console.error('Dashboard load failed:', error)
      return { data: null, error: 'Failed to load dashboard' }
    }
  },
  component: Dashboard,
})

function Dashboard() {
  const { data, error } = Route.useLoaderData()

  return (
    <>
      {error && <div role="alert">{error}</div>}
      {data && <DashboardContent data={data} />}
    </>
  )
}
```

---

## Calling Server Functions from Components

### Direct Calls in Event Handlers

Call server functions directly in event handlers or effects:

```typescript
import { useServerFn } from '@tanstack/solid-start'
import { createSignal } from 'solid-js'

function UserProfile() {
  const [user, setUser] = createSignal(null)
  const [loading, setLoading] = createSignal(false)
  const [error, setError] = createSignal(null)

  const getUserFn = useServerFn(getUser)

  const loadUser = async () => {
    setLoading(true)
    setError(null)
    try {
      const data = await getUserFn({ id: '123' })
      setUser(data)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <>
      <button onClick={loadUser}>Load User</button>
      {loading() && <div>Loading...</div>}
      {error() && <div>Error: {error()}</div>}
      {user() && <div>{user().name}</div>}
    </>
  )
}
```

### Mutations (form submissions, actions)

Use `useServerFn` to wrap mutations with loading states:

```typescript
import { useServerFn } from '@tanstack/solid-start'
import { createSignal } from 'solid-js'

function LoginForm() {
  const [isLoading, setIsLoading] = createSignal(false)
  const loginFn = useServerFn(login)

  const handleSubmit = async (formData: LoginData) => {
    setIsLoading(true)
    try {
      await loginFn(formData)
      // Handle success
    } catch (error) {
      // Handle error
      console.error(error.message)
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <form onSubmit={(e) => {
      e.preventDefault()
      handleSubmit(/* form data */)
    }}>
      {/* Form fields */}
      <button disabled={isLoading()}>
        {isLoading() ? 'Logging in...' : 'Login'}
      </button>
    </form>
  )
}
```

### Lazy Loading with Effects

Use `createEffect` to load data when dependencies change:

```typescript
import { useServerFn } from '@tanstack/solid-start'
import { createSignal, createEffect } from 'solid-js'

function PostDetail(props) {
  const [post, setPost] = createSignal(null)
  const [loading, setLoading] = createSignal(false)

  const getPostFn = useServerFn(getPost)

  createEffect(async () => {
    setLoading(true)
    try {
      const data = await getPostFn({ id: props.postId })
      setPost(data)
    } finally {
      setLoading(false)
    }
  })

  return (
    <>
      {loading() && <div>Loading...</div>}
      {post() && <article>{post().title}</article>}
    </>
  )
}
```

---

## Error Handling

### Throwing Built-In Errors

```typescript
import { createServerFn } from '@tanstack/solid-start'
import { notFound, redirect } from '@tanstack/solid-router'

const getUser = createServerFn()
  .inputValidator((data: { id: string }) => data)
  .handler(async ({ data }) => {
    const user = await db.users.findUnique({ where: { id: data.id } })

    if (!user) {
      throw notFound() // 404
    }

    return user
  })

const loginUser = createServerFn({ method: 'POST' })
  .handler(async (credentials) => {
    const user = await authenticateUser(credentials)

    if (!user) {
      throw redirect({ to: '/login' }) // Navigate to login
    }

    return user
  })
```

### Custom Error Serialization

Errors thrown in server functions are automatically serialized and available on the client:

```typescript
const riskyOperation = createServerFn().handler(async () => {
  if (Math.random() > 0.5) {
    throw new Error('Something went wrong!')
  }
  return { success: true }
})

// On client
try {
  await riskyOperation()
} catch (error) {
  // error.message is available (serialized from server)
  console.log(error.message)
}
```

---

## Best Practices

### 1. **Define Server Functions Close to Where They're Used**

Keep server function definitions in the same file as the route or feature that uses them:

```typescript
// src/routes/posts.tsx
const getPosts = createServerFn().handler(async () => {
  return db.posts.findMany()
})

export const Route = createFileRoute('/posts')({
  loader: () => getPosts(),
  component: PostsList,
})
```

### 2. **Always Validate Input with Zod**

Use `inputValidator` for all server functions that accept arguments:

```typescript
const getPost = createServerFn()
  .inputValidator((data: unknown) => GetPostSchema.parse(data))
  .handler(async ({ data }) => {
    // data is strongly typed
    return db.posts.findUnique({ where: { id: data.id } })
  })
```

### 3. **Return Serializable Data**

Server functions return data over the network, so return only serializable types:

```typescript
// ✅ GOOD - Serializable
export const getUserProfile = createServerFn().handler(async () => {
  return {
    id: '123',
    name: 'John',
    createdAt: new Date().toISOString(), // String, not Date
    tags: ['admin', 'user'],
  }
})

// ❌ BAD - Non-serializable (Date, Map, functions)
export const getBadData = createServerFn().handler(async () => {
  return {
    createdAt: new Date(), // NOT serializable!
    handler: () => {}, // Functions not serializable!
  }
})
```

### 4. **Use GET for Queries, POST for Mutations**

```typescript
// Fetching data
const getPosts = createServerFn().handler(async () => {
  return db.posts.findMany()
})

// Modifying data
const createPost = createServerFn({ method: 'POST' })
  .handler(async (input) => {
    return db.posts.create({ data: input })
  })
```

### 5. **Separate Server Functions by Feature**

Store server functions in `src/modules/{feature}/service/` with their schemas:

```
src/modules/posts/
  schema/
    posts.ts           # Zod schemas (GetPostInput, CreatePostOutput, etc.)
  service/
    postService.ts     # Server functions (getPosts, createPost, etc.)
  repository/
    postRepository.ts  # Database/API calls (if abstracted)
```

### 6. **Avoid Long-Running Operations in Loaders**

Loaders block initial page render. For heavy work, use streaming or background jobs:

```typescript
// ✅ GOOD - Fast loader, data streams after
export const Route = createFileRoute('/dashboard')({
  loader: async () => {
    // Fetch critical data only
    return getBasicDashboardData()
  },
  component: Dashboard,
})

function Dashboard() {
  const basicData = Route.useLoaderData()
  const detailsQuery = createQuery(() => ({
    queryKey: ['details'],
    queryFn: () => getDetailedData(),
  }))

  return (
    <>
      <BasicView data={basicData} />
      {detailsQuery.data && <DetailView data={detailsQuery.data} />}
    </>
  )
}
```

### 7. **Use Streaming for Large Data Sets**

For large responses, use async generators to stream data:

```typescript
type Message = { id: string; content: string }

const streamMessages = createServerFn().handler(async function* () {
  const messages = await db.messages.findMany()
  for (const msg of messages) {
    yield msg
    await new Promise((resolve) => setTimeout(resolve, 100)) // Stagger
  }
})

// Client receives streamed chunks
const messagesStream = streamMessages()
for await (const message of messagesStream) {
  // Process each message as it arrives
}
```

---

## Integration with Modules & Features

### Example: Posts Feature

```
src/modules/client/posts/
  schema/
    posts.ts
      ├─ GetPostsInput
      ├─ GetPostsOutput
      ├─ CreatePostInput
      └─ CreatePostOutput
  service/
    postService.ts
      ├─ getPosts() → server function
      ├─ getPostById() → server function
      └─ createPost() → server function
  repository/
    postRepository.ts
      ├─ Interface definitions
      └─ API client or DB adapter
  components/
    PostsList.tsx
    PostDetail.tsx
```

**File: `src/modules/client/posts/schema/posts.ts`**

```typescript
import { z } from 'zod'

export const PostSchema = z.object({
  id: z.string(),
  title: z.string(),
  content: z.string(),
  createdAt: z.string().datetime(),
})

export type Post = z.infer<typeof PostSchema>

export const GetPostsInputSchema = z.object({
  limit: z.number().default(10),
})

export type GetPostsInput = z.infer<typeof GetPostsInputSchema>
```

**File: `src/modules/client/posts/service/postService.ts`**

```typescript
import { createServerFn } from '@tanstack/solid-start'
import { GetPostsInputSchema, PostSchema } from '../schema/posts'

export const getPosts = createServerFn()
  .inputValidator((data) => GetPostsInputSchema.parse(data))
  .handler(async ({ data }) => {
    // Database call or API request
    const posts = await fetchPostsFromDB(data)
    return posts.map((p) => PostSchema.parse(p))
  })

export const getPostById = createServerFn()
  .inputValidator((data: { id: string }) => data)
  .handler(async ({ data }) => {
    const post = await fetchPostFromDB(data.id)
    if (!post) {
      throw notFound()
    }
    return PostSchema.parse(post)
  })
```

**File: `src/routes/posts.tsx`**

```typescript
import { createFileRoute } from '@tanstack/solid-router'
import { getPosts } from '~/modules/client/posts/service/postService'
import PostsList from '~/modules/client/posts/components/PostsList'

export const Route = createFileRoute('/posts')({
  loader: () => getPosts({ limit: 20 }),
  component: PostsList,
})
```

---

## Summary Rules

1. ✅ **Always use `createServerFn` for server-only operations**
2. ✅ **Use route loaders for initial data fetching**
3. ✅ **Validate all inputs with Zod schemas**
4. ✅ **Return only serializable data**
5. ✅ **Use GET for queries, POST for mutations**
6. ✅ **Organize server functions in `src/modules/{feature}/service/`**
7. ✅ **Handle errors with `notFound()`, `redirect()`, or custom Error throws**
8. ✅ **Wrap components that call server functions with `useServerFn` + TanStack Query**
9. ✅ **Keep loaders fast; stream large data or defer to client-side queries**
10. ✅ **Never import server functions into client-only modules without `createServerFn`**
