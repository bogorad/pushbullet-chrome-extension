# Agent Guidelines for Pushbullet Chrome Extension

## Build Commands
- `npm run build` - Build all extension components with esbuild
- `npm run typecheck` - Run TypeScript type checking
- `npm run lint` - Lint TypeScript files with ESLint
- `npm run lint:fix` - Auto-fix ESLint issues
- `node ./scripts/bump-patch.cjs` - Bump patch level

## Test Commands
- `npm run test` - Run all tests with Vitest
- `npm run test:watch` - Run tests in watch mode
- `npm run test:coverage` - Run tests with coverage report
- `vitest run path/to/test.ts` - Run single test file

## Code Style Guidelines
- **Formatting**: 2-space indentation, single quotes, semicolons required, ES2022 target
- **TypeScript**: Strict mode, explicit types over `any`, interfaces for complex objects, async/await
- **Imports**: Group stdlib → third-party → local modules, relative imports, barrel exports
- **Naming**: camelCase variables/functions, PascalCase types, SCREAMING_SNAKE_CASE constants, `_` prefix unused params
- **Error Handling**: Try/catch for async ops, centralized logging, graceful degradation, event-driven tracking
- **Architecture**: Repository pattern, event bus, state machine, single-flight pattern
- **Security**: Input sanitization, CSP compliance, message validation, no sensitive data in logs
