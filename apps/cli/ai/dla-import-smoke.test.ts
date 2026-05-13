import { describe, expect, it } from 'vitest';

/**
 * Smoke-imports the `@studio/dla` workspace package to confirm the
 * TypeScript path alias, Vite resolve alias, and package.json `file:`
 * dependency are all wired correctly. The placeholder export is the
 * only thing this package exposes today; it will be replaced by the
 * real Data Liberation Agent bridge surface in a follow-up task,
 * along with this test.
 */
describe( '@studio/dla workspace package', () => {
	it( 'resolves the package entry point and exposes the placeholder export', async () => {
		const dlaModule = await import( '@studio/dla' );
		expect( dlaModule.PLACEHOLDER ).toBe( true );
	} );
} );
