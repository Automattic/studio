import { platform } from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { addDomainToHosts, removeDomainFromHosts, writeHostsFile } from 'cli/lib/hosts-file';
import { sudoExec } from 'cli/lib/sudo-exec';

const fsState = vi.hoisted( () => ( {
	readContent: '',
	writtenContent: null as string | null,
} ) );

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
	const writeFile: typeof actual.writeFile = ( ( _p: unknown, data: unknown, cb: unknown ) => {
		fsState.writtenContent = data as string;
		( cb as ( err: null ) => void )( null );
	} ) as typeof actual.writeFile;
	const readFile: typeof actual.readFile = ( ( _p: unknown, _opts: unknown, cb: unknown ) => {
		( cb as ( err: null, data: string ) => void )( null, fsState.readContent );
	} ) as typeof actual.readFile;
	return {
		...actual,
		default: { ...actual, writeFile, readFile },
		writeFile,
		readFile,
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

describe( 'addDomainToHosts', () => {
	beforeEach( () => {
		vi.mocked( platform ).mockReturnValue( 'darwin' );
		fsState.readContent = '';
		fsState.writtenContent = null;
	} );

	it( 'writes both an IPv4 and an IPv6 loopback entry for a new domain', async () => {
		await addDomainToHosts( 'my-project.local', 8000 );

		expect( fsState.writtenContent ).toContain( '127.0.0.1 my-project.local # Port 8000' );
		expect( fsState.writtenContent ).toContain( '::1 my-project.local # Port 8000' );
		expect( fsState.writtenContent ).toContain( '# BEGIN WordPress Studio' );
		expect( fsState.writtenContent ).toContain( '# END WordPress Studio' );
	} );

	it( 'migrates a legacy IPv4-only entry by adding the IPv6 entry', async () => {
		fsState.readContent = [
			'# BEGIN WordPress Studio',
			'127.0.0.1 my-project.local # Port 8000',
			'# END WordPress Studio',
		].join( '\n' );

		await addDomainToHosts( 'my-project.local', 8000 );

		expect( fsState.writtenContent ).toContain( '127.0.0.1 my-project.local # Port 8000' );
		expect( fsState.writtenContent ).toContain( '::1 my-project.local # Port 8000' );
	} );

	it( 'does not rewrite the hosts file when the entries are already present', async () => {
		fsState.readContent = [
			'# BEGIN WordPress Studio',
			'127.0.0.1 my-project.local # Port 8000',
			'::1 my-project.local # Port 8000',
			'# END WordPress Studio',
		].join( '\n' );

		await addDomainToHosts( 'my-project.local', 8000 );

		expect( fsState.writtenContent ).toBeNull();
		expect( vi.mocked( sudoExec ) ).not.toHaveBeenCalled();
	} );
} );

describe( 'removeDomainFromHosts', () => {
	beforeEach( () => {
		vi.mocked( platform ).mockReturnValue( 'darwin' );
		fsState.readContent = [
			'# BEGIN WordPress Studio',
			'127.0.0.1 my-project.local # Port 8000',
			'::1 my-project.local # Port 8000',
			'# END WordPress Studio',
		].join( '\n' );
		fsState.writtenContent = null;
	} );

	it( 'removes both the IPv4 and IPv6 entries', async () => {
		await removeDomainFromHosts( 'my-project.local' );

		// The block is emptied and removed entirely.
		expect( fsState.writtenContent ).not.toContain( 'my-project.local' );
		expect( fsState.writtenContent ).not.toContain( '# BEGIN WordPress Studio' );
	} );
} );
