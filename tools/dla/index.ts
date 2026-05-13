/**
 * Entry point for the `@studio/dla` workspace package.
 *
 * This package will host the Data Liberation Agent MCP-stdio bridge that
 * proxies the upstream `data-liberation` MCP server into the Studio CLI's
 * pi-agent runtime. The bridge implementation lands in a follow-up task;
 * for now this module only exposes a placeholder so the package can be
 * imported by consumers (apps/cli) ahead of the wiring work.
 */

/**
 * Marker export used by the import-smoke test to confirm that the
 * `@studio/dla` alias resolves through both TypeScript and the bundler.
 * It will be replaced by real bridge exports in a follow-up task.
 */
export const PLACEHOLDER = true;
