import { dialog, type BrowserWindow } from 'electron';
import { EventEmitter } from 'events';
import os from 'os';
import path from 'path';
import { Readable } from 'stream';
import { https } from 'follow-redirects';
import fs from 'fs-extra';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { sendIpcEventToRenderer } from 'src/ipc-utils';
import { downloadBackup, handleImportSite } from '../handlers/import-site';
import { buildStudioActionLink, parseStudioActionLink } from '../studio-action-link';

vi.mock( 'follow-redirects', () => ( { https: { get: vi.fn() } } ) );
vi.mock( 'electron', () => ( {
	dialog: { showMessageBox: vi.fn().mockResolvedValue( { response: 1 } ) },
	shell: { openPath: vi.fn() },
} ) );
vi.mock( 'src/ipc-utils', () => ( { sendIpcEventToRenderer: vi.fn() } ) );
vi.mock( 'src/logging', () => ( { getLogsFilePath: () => '/logs' } ) );
const window = {} as BrowserWindow;

const directories: string[] = [];
afterEach( async () => {
	await Promise.all( directories.splice( 0 ).map( ( dir ) => fs.remove( dir ) ) );
	vi.clearAllMocks();
	vi.restoreAllMocks();
} );

function respond( bytes: Buffer, length = bytes.length ) {
	vi.mocked( https.get ).mockImplementation( ( (
		_url: unknown,
		_options: unknown,
		callback: ( response: unknown ) => void
	) => {
		const request = Object.assign( new EventEmitter(), { setTimeout: vi.fn(), destroy: vi.fn() } );
		queueMicrotask( () =>
			callback(
				Object.assign( Readable.from( [ bytes ] ), {
					statusCode: 200,
					headers: { 'content-length': String( length ) },
				} )
			)
		);
		return request;
	} ) as unknown as typeof https.get );
}

it.each( [
	[ Buffer.from( [ 0x50, 0x4b, 3, 4, 0, 0 ] ), '.zip' ],
	[ Buffer.from( [ 0x1f, 0x8b, 8, 0 ] ), '.tar.gz' ],
] )( 'downloads an extensionless backup using magic bytes %s', async ( bytes, extension ) => {
	respond( bytes );
	await handleImportSite(
		{
			action: 'import-site',
			url: 'https://liberate.sh/api/jobs/1/files/site',
			name: '../../example.zip',
		},
		window
	);
	const payload = vi.mocked( sendIpcEventToRenderer ).mock.calls[ 0 ][ 1 ] as {
		backup: { path: string; name: string };
	};
	expect( path.basename( payload.backup.path ) ).toBe( payload.backup.name );
	expect( payload.backup.name ).not.toContain( '/' );
	expect( payload.backup.name.endsWith( extension ) ).toBe( true );
	expect( await fs.pathExists( payload.backup.path ) ).toBe( true );
	expect( dialog.showMessageBox ).not.toHaveBeenCalled();
	const options = vi.mocked( https.get ).mock.calls[ 0 ][ 1 ] as {
		beforeRedirect: ( options: { protocol: string } ) => void;
	};
	expect( () => options.beforeRedirect( { protocol: 'http:' } ) ).toThrow();
	expect( () => options.beforeRedirect( { protocol: 'https:' } ) ).not.toThrow();
} );

it( 'rejects oversized downloads before writing a file', async () => {
	respond( Buffer.from( 'zip' ), 1024 * 1024 * 1024 + 1 );
	const directory = await fs.mkdtemp( path.join( os.tmpdir(), 'studio-download-test-' ) );
	directories.push( directory );
	await expect(
		downloadBackup( 'https://liberate.sh/file', path.join( directory, 'file' ) )
	).rejects.toThrow();
	expect( await fs.readdir( directory ) ).toEqual( [] );
} );

it( 'rejects non-archive content with a logs error and removes the download', async () => {
	respond( Buffer.from( '<html>not a backup</html>' ) );
	vi.spyOn( console, 'error' ).mockImplementation( () => {} );
	const rename = vi.spyOn( fs, 'rename' );
	await handleImportSite( { action: 'import-site', url: 'https://liberate.sh/file' }, window );
	expect( rename ).not.toHaveBeenCalled();
	expect( sendIpcEventToRenderer ).not.toHaveBeenCalled();
	expect( dialog.showMessageBox ).toHaveBeenCalledWith(
		expect.anything(),
		expect.objectContaining( {
			buttons: [ 'Open WordPress Studio Logs', 'OK' ],
		} )
	);
} );

const backup = 'https://liberate.sh/api/jobs/123/files/site';
const link = ( query: string ) => `wp-studio://app/v1/import-site?${ query }`;

describe( 'import-site links', () => {
	it.each( [
		[ `url=${ encodeURIComponent( backup ) }`, { action: 'import-site', url: backup } ],
		[
			`url=${ encodeURIComponent( backup ) }&name=example.com.zip`,
			{ action: 'import-site', url: backup, name: 'example.com.zip' },
		],
	] )( 'parses %s', ( query, expected ) => {
		expect( parseStudioActionLink( link( query ) ) ).toEqual( expected );
	} );
	it.each( [
		'url=http://liberate.sh/file',
		'url=file:///tmp/site.zip',
		'url=https://evil.com/file',
		'url=https://liberate.sh.evil.com/file',
		'url=https://evilliberate.sh/file',
		'url=https://user@liberate.sh/file',
		'url=https://liberate.sh:444/file',
		'url=not-a-url',
		'url=https%253A%252F%252Fliberate.sh',
		'',
		`url=${ backup }&extra=1`,
		`url=${ backup }&url=${ backup }`,
		`url=${ backup }&name=x&name=y`,
		`url=${ backup }&name=`,
		`url=${ backup }&name=${ 'x'.repeat( 256 ) }`,
	] )( 'rejects %s', ( query ) => {
		expect( parseStudioActionLink( link( query ) ) ).toBeNull();
	} );
	it( 'round trips without decoding a second time', () => {
		const target = {
			action: 'import-site' as const,
			url: `${ backup }?token=%2Fsecret`,
			name: 'site.zip',
		};
		expect( parseStudioActionLink( buildStudioActionLink( target ) ) ).toEqual( target );
	} );
} );
