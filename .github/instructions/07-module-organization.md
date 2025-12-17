# Module Organization (DDD)

## Feature Module Layout

Each feature under `src/modules/{client|server}/{feature}/` may include:

```
library/
  components/          # Feature UI (composed from ui/* and styled-system)
  schema/              # Zod schemas (requests, responses, domain models)
  service/             # Use-cases, business logic, orchestration
  repository/          # IO boundaries (APIs, storage, interfaces)
  utils/               # Pure utilities (no side effects)
  index.ts             # Public exports (service layer only)
```

## Boundaries & Layers

- **UI Layer** (`components/`): Call `service` functions only, never `repository` directly
- **Application Layer** (`service/`): Orchestrates repositories and enforces domain rules
- **Infrastructure Layer** (`repository/`): Interfaces & adapters for external IO
- **Domain Layer** (`schema/`): Zod schemas + validators; pure business rules
- **Utils** (`utils/`): Reusable, pure functions with no side effects

## Example: Library Feature

```
src/modules/client/library/
  components/
    LibraryList.tsx       # UI for displaying library
  schema/
    library.ts            # Zod schemas (e.g., Library, CreateLibraryInput)
  service/
    libraryService.ts     # Fetches, transforms, validates
  repository/
    libraryRepository.ts  # HTTP calls or API client wrapper
  utils/
    libraryHelpers.ts     # Sorting, filtering helpers
  index.ts                # export { libraryService } or public functions
```

## Cross-Module Imports

- Import from a feature's **public interface** (`index.ts`), not internal paths
- **Never import from `src/modules/server/` into client code**—this breaks SSR/CSR
- Use explicit **server functions** as network boundary for server-only logic
