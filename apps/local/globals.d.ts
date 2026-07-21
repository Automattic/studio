// `wpcom-xhr-request` ships no types; `@studio/common`'s sync code imports it
// (pulled in here via the syncable-sites fetch). Each app declares it for its
// own compilation, mirroring apps/cli/globals.d.ts and apps/studio.
declare module 'wpcom-xhr-request';
