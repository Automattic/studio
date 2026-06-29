/**
 * @vitest-environment node
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { executeCliCommand } from 'src/modules/cli/lib/execute-command';
import { TypedEventEmitter } from 'src/modules/cli/lib/typed-event-emitter';
import { createSiteViaCli } from '../cli-site-creator';

vi.mock( 'src/modules/cli/lib/execute-command', () => ( {
	executeCliCommand: vi.fn(),
} ) );

vi.mock( 'src/ipc-utils', () => ( {
	sendIpcEventToRenderer: vi.fn(),
} ) );

type CliEventMap = Record< string, unknown >;

function buildEmitter() {
	const emitter = new TypedEventEmitter< CliEventMap >();
	vi.mocked( executeCliCommand ).mockReturnValue( [
		emitter,
		// childProcess shape isn't read by createSiteViaCli for this test
		{} as never,
	] as never );
	return emitter;
}

describe( 'createSiteViaCli', () => {
	beforeEach( () => {
		vi.mocked( executeCliCommand ).mockReset();
	} );

	afterEach( () => {
		vi.restoreAllMocks();
	} );

	it( 'resolves with the port emitted by the CLI', async () => {
		const emitter = buildEmitter();

		const pending = createSiteViaCli( { path: '/tmp/site-port-emit' } );

		emitter.emit( 'data', {
			data: { action: 'keyValuePair', key: 'id', value: 'site-port-emit' },
		} as never );
		emitter.emit( 'data', {
			data: { action: 'keyValuePair', key: 'port', value: '8765' },
		} as never );
		emitter.emit( 'data', {
			data: { action: 'keyValuePair', key: 'running', value: 'true' },
		} as never );
		emitter.emit( 'success', { result: undefined } as never );

		await expect( pending ).resolves.toEqual( {
			id: 'site-port-emit',
			port: 8765,
			running: true,
		} );
	} );

	it( 'passes the selected database engine to the CLI', async () => {
		const emitter = buildEmitter();

		const pending = createSiteViaCli( {
			path: '/tmp/site-mysql',
			databaseEngine: 'mysql',
		} );

		expect( vi.mocked( executeCliCommand ).mock.calls[ 0 ][ 0 ] ).toEqual(
			expect.arrayContaining( [ '--database-engine', 'mysql' ] )
		);

		emitter.emit( 'data', {
			data: { action: 'keyValuePair', key: 'id', value: 'site-mysql' },
		} as never );
		emitter.emit( 'data', {
			data: { action: 'keyValuePair', key: 'port', value: '8765' },
		} as never );
		emitter.emit( 'success', { result: undefined } as never );

		await expect( pending ).resolves.toEqual( {
			id: 'site-mysql',
			port: 8765,
			running: false,
		} );
	} );

	it( 'rejects when the CLI succeeds without reporting a port', async () => {
		const emitter = buildEmitter();

		const pending = createSiteViaCli( { path: '/tmp/site-port-missing' } );

		emitter.emit( 'data', {
			data: { action: 'keyValuePair', key: 'id', value: 'site-port-missing' },
		} as never );
		emitter.emit( 'data', {
			data: { action: 'keyValuePair', key: 'running', value: 'false' },
		} as never );
		emitter.emit( 'success', { result: undefined } as never );

		await expect( pending ).rejects.toThrow( /no port received/i );
	} );

	it( 'rejects when the CLI emits port 0 (placeholder, never a real assignment)', async () => {
		const emitter = buildEmitter();

		const pending = createSiteViaCli( { path: '/tmp/site-port-zero' } );

		emitter.emit( 'data', {
			data: { action: 'keyValuePair', key: 'id', value: 'site-port-zero' },
		} as never );
		emitter.emit( 'data', {
			data: { action: 'keyValuePair', key: 'port', value: '0' },
		} as never );
		emitter.emit( 'data', {
			data: { action: 'keyValuePair', key: 'running', value: 'true' },
		} as never );
		emitter.emit( 'success', { result: undefined } as never );

		await expect( pending ).rejects.toThrow( /no port received/i );
	} );

	it( 'rejects when the CLI succeeds without reporting an id', async () => {
		const emitter = buildEmitter();

		const pending = createSiteViaCli( { path: '/tmp/site-id-missing' } );

		emitter.emit( 'data', {
			data: { action: 'keyValuePair', key: 'port', value: '8765' },
		} as never );
		emitter.emit( 'data', {
			data: { action: 'keyValuePair', key: 'running', value: 'true' },
		} as never );
		emitter.emit( 'success', { result: undefined } as never );

		await expect( pending ).rejects.toThrow( /no site ID received/i );
	} );
} );
