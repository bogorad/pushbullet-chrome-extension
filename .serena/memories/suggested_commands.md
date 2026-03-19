npm run build
npm run typecheck
npm run lint
npm run test
npm run test:coverage
vitest run tests/popup/popup.test.ts
vitest run tests/app/session.test.ts
vitest run tests/background/utils.test.ts