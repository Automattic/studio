// Shared helpers in `@studio/common` import from this subpath, but the
// package's `exports` map doesn't expose it. The vite configs alias the
// runtime file explicitly — this declaration keeps the TypeScript bundler
// resolver happy without a matching alias.
declare module '@wp-playground/blueprints/blueprint-schema-validator';
