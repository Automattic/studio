/**
 * @vitest-environment node
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The global setup in vitest.setup.ts stubs out src/storage/paths; undo that
// so we exercise the real implementation.
vi.unmock( 'src/storage/paths' );

describe( 'getCliBinaryPath', () => {
	const originalNodeEnv = process.env.NODE_ENV;

	beforeEach( () => {
		vi.resetModules();
	} );

	afterEach( () => {
		process.env.NODE_ENV = originalNodeEnv;
	} );

	it( 'returns null outside production so callers fall back to the CLI script + system node', async () => {
		process.env.NODE_ENV = 'development';
		const { getCliBinaryPath } = await import( '../paths' );
		expect( getCliBinaryPath() ).toBeNull();
	} );

	it( 'returns null in test for the same reason', async () => {
		process.env.NODE_ENV = 'test';
		const { getCliBinaryPath } = await import( '../paths' );
		expect( getCliBinaryPath() ).toBeNull();
	} );
} );
