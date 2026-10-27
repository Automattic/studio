import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { spawnPhpProcess } from 'cli/lib/native-php/php-process';
import { runReprintCommandUntilComplete } from './reprint-client';
import type { ChildProcess } from 'node:child_process';

vi.mock( import( 'node:fs' ), async ( importOriginal ) => {
	const actual = await importOriginal();
	return { ...actual, default: { ...actual, existsSync: () => true }, existsSync: () => true };
} );
vi.mock( import( 'cli/lib/dependency-management/paths' ), () => ( {
	getReprintPharPath: () => '/bundle/reprint.phar',
} ) );
vi.mock( import( 'cli/lib/dependency-management/php-binary' ), () => ( {
	ensurePhpBinaryAvailable: vi.fn(),
} ) );
vi.mock( import( 'cli/lib/native-php/php-process' ), () => ( {
	spawnPhpProcess: vi.fn(),
	reapPhpTreeOnInterrupt: () => () => undefined,
} ) );

/** A PHP child that writes `stdout` and exits with `exitCode`. */
function fakeChild( stdout: string, exitCode: number ): ChildProcess {
	const child = new EventEmitter() as ChildProcess;
	const out = new PassThrough();
	Object.assign( child, { stdout: out, stderr: new PassThrough() } );
	setImmediate( () => {
		out.write( stdout );
		out.end();
		setImmediate( () => child.emit( 'close', exitCode ) );
	} );
	return child;
}

describe( 'runReprintCommandUntilComplete', () => {
	beforeEach( () => {
		vi.mocked( spawnPhpProcess ).mockReset();
	} );

	it( 'returns the command result separately from the trailing command report', async () => {
		const metadata = '{"hasCompletedOnce":false,"key":null}';
		vi.mocked( spawnPhpProcess ).mockReturnValue(
			fakeChild(
				`${ metadata }\n` +
					'{"type":"reprint_report","schema_version":1,"command":"pull-metadata","status":"complete","exit_code":0,"failed_stage":null,"error":null,"error_code":null}\n',
				0
			)
		);

		const result = await runReprintCommandUntilComplete( [ 'pull-metadata', 'https://x/' ] );

		expect( result.stdout ).toBe( metadata );
		expect( result.report ).toMatchObject( { command: 'pull-metadata', status: 'complete' } );
	} );

	it( 'exposes the fields a command adds to its report', async () => {
		vi.mocked( spawnPhpProcess ).mockReturnValue(
			fakeChild(
				'{"type":"reprint_report","schema_version":1,"command":"keygen","status":"complete","exit_code":0,"failed_stage":null,"error":null,"error_code":null,"key_id":"abc","public_key":"MIIB"}',
				0
			)
		);

		const result = await runReprintCommandUntilComplete( [ 'keygen', 'https://x/' ] );

		expect( result.stdout ).toBe( '' );
		expect( result.report?.public_key ).toBe( 'MIIB' );
	} );
} );
