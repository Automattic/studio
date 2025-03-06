# WordPress Studio Development Guide

## Build/Test Commands
- Start app: `npm start`
- Run all tests: `npm test`
- Run single test: `npm test -- -t "test name pattern"`
- Watch tests: `npm run test:watch`
- E2E tests: `npm run e2e`
- Lint code: `npm run lint`
- Format code: `npm run format`

## Code Style
- TypeScript for type safety; avoid `any` except in rest args
- Format: tabs (width 2), 100 char line limit, single quotes, trailing commas
- Imports: ordered (builtin → external → internal → parent → sibling)
- Naming: camelCase for variables/functions, PascalCase for components/classes
- React components: functional with hooks, avoid class components
- State management: Redux with @reduxjs/toolkit
- Error handling: prefer early returns with specific error messages
- Tests: placed in nearby `tests` directories with `.test.ts(x)` extension

## Folder Structure
- `/src` - Application source code
- `/e2e` - Playwright end-to-end tests
- `/scripts` - Build and deployment scripts