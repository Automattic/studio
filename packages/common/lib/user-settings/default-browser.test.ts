import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import { afterEach, expect, it, vi } from 'vitest';
import { detectDefaultBrowser } from './default-browser';

vi.mock( 'node:child_process', () => ( { execFile: vi.fn() } ) );
vi.mock( 'node:fs/promises', () => ( { default: { readFile: vi.fn() } } ) );

afterEach( () => {
	vi.restoreAllMocks();
	vi.unstubAllEnvs();
} );

function commandResults( ...results: Array< string | Error > ) {
	vi.mocked( execFile ).mockImplementation( ( (
		_command: string,
		_args: string[],
		_options: unknown,
		callback: ( error: Error | null, stdout: string, stderr: string ) => void
	) => {
		const result = results.shift();
		callback(
			result instanceof Error ? result : null,
			typeof result === 'string' ? result : '',
			''
		);
	} ) as typeof execFile );
}

it.each( [
	[ 'Safari', 'safari' ],
	[ 'Google Chrome', 'chrome' ],
	[ 'Zen', undefined ],
] )(
	'reads the macOS default as %s without guessing from installed browsers',
	async ( name, browser ) => {
		vi.spyOn( process, 'platform', 'get' ).mockReturnValue( 'darwin' );
		commandResults( JSON.stringify( { name } ) );
		expect( await detectDefaultBrowser() ).toEqual( { name, ...( browser ? { browser } : {} ) } );
		expect( execFile ).toHaveBeenCalledWith(
			'/usr/bin/osascript',
			expect.any( Array ),
			expect.objectContaining( { timeout: 2000 } ),
			expect.any( Function )
		);
	}
);

it( 'reads the Windows HTTPS association and its application name', async () => {
	vi.spyOn( process, 'platform', 'get' ).mockReturnValue( 'win32' );
	commandResults(
		'    ProgId    REG_SZ    MSEdgeHTM',
		'    ApplicationName    REG_SZ    Microsoft Edge'
	);
	expect( await detectDefaultBrowser() ).toEqual( { name: 'Microsoft Edge', browser: 'edge' } );
} );

it( 'reads the Linux default desktop entry from the user data directory', async () => {
	vi.spyOn( process, 'platform', 'get' ).mockReturnValue( 'linux' );
	vi.stubEnv( 'XDG_DATA_HOME', '/home/example/.local/share' );
	commandResults( 'firefox.desktop' );
	vi.mocked( fs.readFile ).mockResolvedValue(
		'[Desktop Entry]\nName=Firefox\n[Desktop Action NewWindow]\nName=Open a new window\n'
	);
	expect( await detectDefaultBrowser() ).toEqual( { name: 'Firefox', browser: 'firefox' } );
	expect( fs.readFile ).toHaveBeenCalledWith(
		'/home/example/.local/share/applications/firefox.desktop',
		'utf8'
	);
} );

it( 'falls back safely if the system default cannot be read', async () => {
	vi.spyOn( process, 'platform', 'get' ).mockReturnValue( 'darwin' );
	commandResults( new Error( 'lookup unavailable' ) );
	expect( await detectDefaultBrowser() ).toBeNull();
} );
