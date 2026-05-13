/**
 * Module-resolution helpers for the `studio migrate` command. Extracted
 * into their own file so tests can mock the resolution layer (which
 * normally walks `node_modules`) without touching the spawn pipeline.
 */

import { createRequire } from 'node:module';

const require = createRequire( import.meta.url );

/**
 * Resolve DLA's CLI entry to an absolute path.
 *
 * @returns Absolute path to `data-liberation/src/cli.ts`.
 */
export function resolveDlaCliEntry(): string {
	return require.resolve( 'data-liberation/src/cli.ts' );
}

/**
 * Resolve the `tsx` runtime CLI to an absolute path.
 *
 * Spelled as `tsx/cli` (the public exports key) rather than
 * `tsx/dist/cli.mjs` because the package's `exports` map does not
 * expose the `dist/` subpath directly.
 *
 * @returns Absolute path to `tsx/dist/cli.mjs`.
 */
export function resolveTsxCli(): string {
	return require.resolve( 'tsx/cli' );
}
