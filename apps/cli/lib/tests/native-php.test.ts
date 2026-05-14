import fs from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';
import {
	createNativePhpSubprocessIniDirectory,
	getDefaultPhpArgs,
	getNativePhpCaBundleArgs,
	getNativePhpCaBundlePath,
	getNativePhpSubprocessIniContents,
} from 'cli/lib/native-php';

describe( 'native PHP helpers', () => {
	it( 'creates a subprocess php.ini directory', async () => {
		const phpIniDirectory = await createNativePhpSubprocessIniDirectory( '8.4' );

		try {
			const phpIniPath = path.join( phpIniDirectory, 'php.ini' );
			const caBundlePath = getNativePhpCaBundlePath( phpIniDirectory );
			const contents = fs.readFileSync( phpIniPath, 'utf8' );

			expect( contents ).toContain( 'memory_limit=512M' );
			expect( fs.existsSync( caBundlePath ) ).toBe( true );
			expect( contents ).toContain( 'openssl.cafile="' );
			expect( contents ).toContain( 'curl.cainfo="' );
			if ( process.platform === 'win32' ) {
				expect( contents ).toContain( 'extension=pdo_sqlite' );
				expect( contents ).toContain( 'extension=sqlite3' );
			}
		} finally {
			await fs.promises.rm( phpIniDirectory, { recursive: true, force: true } );
		}
	} );

	it( 'builds PHP args for the generated CA bundle', () => {
		const caBundlePath = path.join( 'tmp', 'ca-bundle.crt' );

		expect( getNativePhpCaBundleArgs( caBundlePath ) ).toEqual( [
			'-d',
			expect.stringContaining( 'openssl.cafile=' ),
			'-d',
			expect.stringContaining( 'curl.cainfo=' ),
		] );
	} );

	it( 'keeps parent PHP invocations isolated from php.ini files', () => {
		const args = getDefaultPhpArgs( '8.4' );

		expect( args ).toContain( '-n' );
		if ( process.platform === 'win32' ) {
			expect( args ).toContain( 'extension=pdo_sqlite' );
		}
	} );

	it( 'loads bundled Windows extensions in subprocess php.ini contents', () => {
		const contents = getNativePhpSubprocessIniContents(
			'8.4',
			path.join( 'tmp', 'ca-bundle.crt' )
		);

		if ( process.platform === 'win32' ) {
			expect( contents ).toContain( 'extension_dir="' );
			expect( contents ).toContain( 'extension=pdo_sqlite' );
			expect( contents ).toContain( 'extension=sqlite3' );
		} else {
			expect( contents ).toContain( 'memory_limit=512M' );
		}
	} );
} );
