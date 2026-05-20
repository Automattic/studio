import { describe, it, expect, vi } from 'vitest';

// Mock electron and dependencies before importing the module
vi.mock( 'electron', () => ( {
	app: { on: vi.fn(), off: vi.fn() },
} ) );
vi.mock( '@sentry/electron/main', () => ( {
	captureException: vi.fn(),
} ) );
vi.mock( 'src/storage/paths', () => ( {
	getCliPath: () => '/mock/cli/path',
} ) );
vi.mock( 'src/ipc-utils', () => ( {
	sendIpcEventToRenderer: vi.fn(),
} ) );

describe( 'StudioCodeProcess module', () => {
	it( 'should export expected functions', async () => {
		const mod = await import( '../studio-code-process' );
		expect( mod.spawnTurn ).toBeDefined();
		expect( mod.abortTurn ).toBeDefined();
		expect( mod.stopAllProcesses ).toBeDefined();
	} );

	it( 'abortTurn does not throw for unknown siteId', async () => {
		const mod = await import( '../studio-code-process' );
		expect( () => mod.abortTurn( 'nonexistent-site' ) ).not.toThrow();
	} );

	it( 'stopAllProcesses does not throw when no processes exist', async () => {
		const mod = await import( '../studio-code-process' );
		expect( () => mod.stopAllProcesses() ).not.toThrow();
	} );
} );
