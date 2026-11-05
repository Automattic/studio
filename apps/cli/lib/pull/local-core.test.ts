import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, expect, it } from 'vitest';
import { linkPulledWpContent } from 'cli/lib/pull/local-core';

let root: string;

afterEach( () => fs.rmSync( root, { recursive: true, force: true } ) );

// Making the symlinks this test sets up needs admin rights on Windows.
it.skipIf( process.platform === 'win32' )(
	"links a site's wp-content to the pulled one when the site's path goes through a symlink",
	() => {
		root = fs.realpathSync( fs.mkdtempSync( path.join( os.tmpdir(), 'local-core-' ) ) );
		const pulledWpContent = path.join( root, 'pulls', 'raw', 'srv', 'htdocs', 'wp-content' );
		fs.mkdirSync( pulledWpContent, { recursive: true } );
		fs.writeFileSync( path.join( pulledWpContent, 'pulled.txt' ), 'pulled' );
		// Deeper than the path through the symlink, as `/tmp` is a link to `/private/tmp` on macOS.
		fs.mkdirSync( path.join( root, 'private', 'sites', 'site', 'wp-content' ), {
			recursive: true,
		} );
		fs.symlinkSync( path.join( root, 'private', 'sites' ), path.join( root, 'sites' ) );

		const sitePath = path.join( root, 'sites', 'site' );
		linkPulledWpContent( sitePath, pulledWpContent );
		// A link that already points there is kept.
		linkPulledWpContent( sitePath, pulledWpContent );
		expect( fs.readFileSync( path.join( sitePath, 'wp-content', 'pulled.txt' ), 'utf8' ) ).toBe(
			'pulled'
		);

		// A link made relative to the path as written, which doesn't resolve, is replaced.
		fs.rmSync( path.join( sitePath, 'wp-content' ) );
		fs.symlinkSync(
			path.relative( sitePath, pulledWpContent ),
			path.join( sitePath, 'wp-content' )
		);
		linkPulledWpContent( sitePath, pulledWpContent );

		expect( fs.readFileSync( path.join( sitePath, 'wp-content', 'pulled.txt' ), 'utf8' ) ).toBe(
			'pulled'
		);
	}
);
