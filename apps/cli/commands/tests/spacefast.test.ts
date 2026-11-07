import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { copySpacefastSiteFiles } from 'cli/commands/spacefast';

describe( 'copySpacefastSiteFiles', () => {
	let sitePath: string;
	let outputDir: string;

	beforeEach( () => {
		const root = fs.mkdtempSync( path.join( os.tmpdir(), 'studio-spacefast-test-' ) );
		sitePath = path.join( root, 'site' );
		outputDir = path.join( root, 'export' );
		fs.mkdirSync( sitePath );
		fs.mkdirSync( outputDir );
	} );

	afterEach( () => {
		fs.rmSync( path.dirname( sitePath ), { recursive: true, force: true } );
	} );

	it( 'publishes the redirects, headers and robots.txt kept at the site root', async () => {
		fs.writeFileSync(
			path.join( sitePath, '_redirects' ),
			'/install.sh https://example.com/install.sh 302\n'
		);
		fs.writeFileSync( path.join( sitePath, 'robots.txt' ), 'User-agent: *\n' );
		fs.writeFileSync( path.join( outputDir, 'robots.txt' ), 'exported' );

		await copySpacefastSiteFiles( sitePath, outputDir );

		expect( fs.readFileSync( path.join( outputDir, '_redirects' ), 'utf8' ) ).toBe(
			'/install.sh https://example.com/install.sh 302\n'
		);
		expect( fs.readFileSync( path.join( outputDir, 'robots.txt' ), 'utf8' ) ).toBe(
			'User-agent: *\n'
		);
		expect( fs.existsSync( path.join( outputDir, '_headers' ) ) ).toBe( false );
	} );
} );
