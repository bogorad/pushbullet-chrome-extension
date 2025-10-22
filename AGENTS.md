# Agent Guidelines for Pushbullet Chrome Extension

## Build Commands
- `npm run build` - Build all extension components with esbuild
- `npm run typecheck` - Run TypeScript type checking
- `npm run lint` - Lint TypeScript files with ESLint
- `npm run lint:fix` - Auto-fix ESLint issues

## Test Commands
- `npm run test` - Run all tests with Vitest
- `npm run test:watch` - Run tests in watch mode
- `npm run test:coverage` - Run tests with coverage report
- `vitest run path/to/test.ts` - Run single test file

## Code Style Guidelines

### Formatting
- 2-space indentation
- Single quotes for strings (avoid escaping when possible)
- Semicolons always required
- Target ES2022, modules with bundler resolution

### TypeScript
- Strict mode enabled (`noImplicitAny`, `noUncheckedIndexedAccess`)
- Explicit types preferred over `any`
- Interface definitions for complex objects
- Async/await for asynchronous operations

### Imports & Organization
- Group imports: stdlib → third-party → local modules
- Use relative imports for local modules
- Barrel exports (`index.ts`) for clean module boundaries

### Naming Conventions
- camelCase for variables/functions
- PascalCase for classes/interfaces/types
- SCREAMING_SNAKE_CASE for constants
- Prefix unused parameters with `_`

### Error Handling
- Try/catch blocks for async operations
- Centralized error logging via debugLogger
- Graceful degradation for non-critical failures
- Event-driven error tracking

### Architecture Patterns
- Repository pattern for data persistence
- Event bus for cross-component communication
- State machine for service worker lifecycle
- Single-flight pattern for resource loading

### Security
- Input sanitization for user data
- CSP compliance for XSS prevention
- Message validation for extension messaging
- No sensitive data in logs