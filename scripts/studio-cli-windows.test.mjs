import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

describe.skipIf( process.platform !== 'win32' )( 'Windows CLI launcher', () => {
	let directory;
	let launcher;

	beforeAll( () => {
		directory = mkdtempSync( path.join( os.tmpdir(), 'studio launcher ' ) );
		const bin = path.join( directory, 'bin' );
		mkdirSync( bin );
		mkdirSync( path.join( directory, 'cli' ) );
		launcher = path.join( bin, 'studio-cli.bat' );
		copyFileSync( new URL( '../apps/studio/bin/studio-cli.bat', import.meta.url ), launcher );
		copyFileSync( process.execPath, path.join( bin, 'node.exe' ) );
		writeFileSync( path.join( directory, 'cli/main.mjs' ), "console.log('1.9.0');" );
	} );

	afterAll( () => {
		if ( directory ) {
			rmSync( directory, { recursive: true, force: true } );
		}
	} );

	it.each( [ 'normal environment', 'without System32 in PATH', 'without COM in PATHEXT' ] )(
		'prints only the version %s',
		( environment ) => {
			const env = { ...process.env };
			if ( environment === 'without System32 in PATH' ) {
				env.PATH = directory;
			}
			if ( environment === 'without COM in PATHEXT' ) {
				env.PATHEXT = '.EXE;.BAT;.CMD';
			}
			const result = spawnSync(
				process.env.ComSpec,
				[ '/d', '/s', '/c', `""${ launcher }" --version"` ],
				{
					cwd: directory,
					env,
					encoding: 'utf8',
					windowsVerbatimArguments: true,
					timeout: 10000,
				}
			);
			expect( result.stderr ).toBe( '' );
			expect( result.stdout.trim() ).toBe( '1.9.0' );
			expect( result.status ).toBe( 0 );
		},
		15000
	);
} );
