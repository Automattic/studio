import { platform } from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { writeHostsFile } from 'cli/lib/hosts-file';
import { sudoExec } from 'cli/lib/sudo-exec';

vi.mock( 'os', async ( importOriginal ) => {
	const actual = await importOriginal< typeof import('os') >();
	const platformMock = vi.fn( () => 'linux' );
	const tmpdirMock = vi.fn( () => '/tmp/wp-studio-test' );
	return {
		...actual,
		default: { ...actual, platform: platformMock, tmpdir: tmpdirMock },
		platform: platformMock,
		tmpdir: tmpdirMock,
	};
} );

vi.mock( 'fs', async ( importOriginal ) => {
	const actual = await importOriginal< typeof import('fs') >();
	const writeFile: typeof actual.writeFile = ( ( _p: unknown, _d: unknown, cb: unknown ) => {
		( cb as ( err: null ) => void )( null );
	} ) as typeof actual.writeFile;
	return {
		...actual,
		default: { ...actual, writeFile },
		writeFile,
	};
} );

vi.mock( 'cli/lib/sudo-exec', () => ( {
	sudoExec: vi.fn().mockResolvedValue( undefined ),
} ) );

const FAKE_TMPDIR = '/tmp/wp-studio-test';
const FAKE_TEMP_PATH = path.join( FAKE_TMPDIR, 'wp-studio-hosts' );
const FAKE_WINDOWS_ROOT = 'C:\\Windows';

describe( 'writeHostsFile', () => {
	let originalSystemRoot: string | undefined;

	beforeEach( () => {
		vi.mocked( sudoExec ).mockClear();
		originalSystemRoot = process.env.SystemRoot;
		process.env.SystemRoot = FAKE_WINDOWS_ROOT;
	} );

	afterEach( () => {
		if ( originalSystemRoot === undefined ) {
			delete process.env.SystemRoot;
		} else {
			process.env.SystemRoot = originalSystemRoot;
		}
	} );

	it.each( [ 'linux', 'darwin' ] as const )(
		'uses `tee` instead of redirecting directly to `/etc/hosts` on %s',
		async ( osPlatform ) => {
			vi.mocked( platform ).mockReturnValue( osPlatform );

			await writeHostsFile( '127.0.0.1 mysite.local' );

			const [ command, options ] = vi.mocked( sudoExec ).mock.calls[ 0 ];
			expect( command ).toBe( `tee /etc/hosts < ${ FAKE_TEMP_PATH } > /dev/null` );
			expect( options ).toMatchObject( { name: 'WordPress Studio' } );
		}
	);

	it( 'uses `type … > …` on win32', async () => {
		vi.mocked( platform ).mockReturnValue( 'win32' );

		await writeHostsFile( '127.0.0.1 mysite.local' );

		const [ command, options ] = vi.mocked( sudoExec ).mock.calls[ 0 ];
		expect( command ).toContain( `type ${ FAKE_TEMP_PATH } >` );
		expect( command ).toContain( 'hosts' );
		expect( command ).not.toContain( 'tee ' );
		expect( options ).toMatchObject( { name: 'WordPress Studio' } );
	} );
} );
