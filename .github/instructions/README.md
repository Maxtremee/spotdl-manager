# Agent Instructions for spotdl-manager

You are an AI coding agent tasked with implementing features, fixing bugs, and improving the codebase for **spotdl-manager**, a TanStack Start + Solid.js project with SSR, PandaCSS styling, and Biome tooling. Follow these instructions to maintain code quality, consistency, and architectural integrity.

## Documentation Structure

This documentation is organized into the following sections:

1. [Project Overview](./01-project-overview.md) — Tech stack and key technologies
2. [Architecture & Constraints](./02-architecture-constraints.md) — Core principles and file structure
3. [Routing Patterns](./03-routing-patterns.md) — TanStack Router and file-based routing guidelines
4. [SSR Conventions](./04-ssr-conventions.md) — Solid.js SSR compatibility and hydration rules
5. [Styling with PandaCSS](./05-styling-pandacss.md) — Build-time CSS with proper constraints
6. [Validation with Zod](./06-validation-zod.md) — Schema structure and type inference patterns
7. [Module Organization](./07-module-organization.md) — DDD principles and feature boundaries
8. [Environment Variables](./08-environment-variables.md) — Client and server env validation
9. [Developer Workflows](./09-developer-workflows.md) — Common commands and pre-commit checklist
10. [Implementation Checklist](./10-implementation-checklist.md) — Step-by-step feature building guide
11. [Common Gotchas & Solutions](./11-common-gotchas.md) — Solutions table for frequent issues
12. [Code Style & Best Practices](./12-code-style.md) — TypeScript, Solid.js, and project conventions
13. [References](./13-references.md) — Links to key documentation
14. [Server Functions & Route Loaders](./14-server-functions.md) — TanStack Start server functions and route loader patterns
15. [TanStack Form with Solid.js](./15-tanstack-form.md) — Headless form state management with validation and array fields

## Quick Start

- **New to the project?** Start with [Project Overview](./01-project-overview.md) and [Architecture & Constraints](./02-architecture-constraints.md)
- **Building a feature?** Follow the [Implementation Checklist](./10-implementation-checklist.md) and check [Module Organization](./07-module-organization.md)
- **Working with data/API?** See [Server Functions & Route Loaders](./14-server-functions.md) for the route loader pattern
- **Building forms?** Refer to [TanStack Form with Solid.js](./15-tanstack-form.md) for form management and validation
- **Encountering an issue?** See [Common Gotchas & Solutions](./11-common-gotchas.md)
- **Need styling guidance?** Refer to [Styling with PandaCSS](./05-styling-pandacss.md)

## Questions or Edge Cases?

If you encounter scenarios not covered here:

1. **Check the copilot-instructions.md** in the `.github/` folder for project-specific overrides
2. **Refer to library documentation** (see [References](./13-references.md)) for framework-specific patterns
3. **Maintain consistency** with existing code in the same module or feature
4. **When in doubt**, prioritize type safety, SSR compatibility, and DDD separation of concerns

Good luck! Build with confidence.
