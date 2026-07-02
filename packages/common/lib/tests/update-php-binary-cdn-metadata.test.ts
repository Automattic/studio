import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const scriptPath = path.resolve( 'scripts/update-php-binary-cdn-metadata.mjs' );
const sha = 'a'.repeat( 64 );
let tempDir: string;
let metadataPath: string;
let uploadResultsPath: string;

function writeJson( filePath: string, value: unknown ): void {
	fs.writeFileSync( filePath, `${ JSON.stringify( value, null, '\t' ) }\n` );
}

function runUpdater( packageVersion: string ): void {
	execFileSync(
		process.execPath,
		[
			scriptPath,
			'--version',
			'8.4.22',
			'--package-version',
			packageVersion,
			'--upload-results',
			uploadResultsPath,
			'--metadata',
			metadataPath,
		],
		{ stdio: 'pipe' }
	);
}

describe( 'update PHP binary CDN metadata', () => {
	beforeEach( () => {
		tempDir = fs.mkdtempSync( path.join( os.tmpdir(), 'studio-php-metadata-' ) );
		metadataPath = path.join( tempDir, 'metadata.json' );
		uploadResultsPath = path.join( tempDir, 'upload-results.json' );

		writeJson( metadataPath, {
			versions: {
				'8.4': {
					version: '8.4.22',
					artifacts: {
						'win32-x64': {
							url: 'https://example.com/8.4.22/full-install',
							sha: 'b'.repeat( 64 ),
						},
					},
				},
			},
		} );
		writeJson( uploadResultsPath, {
			'php-8.4.22-cli-windows-x86_64.zip': {
				cdn_url: 'https://example.com/8.4.22-1.0.0/full-install',
				sha,
			},
		} );
	} );

	afterEach( () => {
		fs.rmSync( tempDir, { recursive: true, force: true } );
	} );

	it( 'tracks an immutable package revision separately from the PHP version', () => {
		runUpdater( '1.0.0' );

		const metadata = JSON.parse( fs.readFileSync( metadataPath, 'utf8' ) );
		expect( metadata.versions[ '8.4' ] ).toEqual( {
			version: '8.4.22',
			packageVersion: '1.0.0',
			artifacts: {
				'win32-x64': {
					url: 'https://example.com/8.4.22-1.0.0/full-install',
					sha,
				},
			},
		} );
	} );

	it( 'stores the explicit package identifier even when it matches the PHP version', () => {
		runUpdater( '8.4.22' );

		const metadata = JSON.parse( fs.readFileSync( metadataPath, 'utf8' ) );
		expect( metadata.versions[ '8.4' ].packageVersion ).toBe( '8.4.22' );
	} );

	it( 'allows an engineer to select a different immutable package identifier', () => {
		runUpdater( 'vc-runtime-2' );
		runUpdater( 'vc-runtime-1' );

		const metadata = JSON.parse( fs.readFileSync( metadataPath, 'utf8' ) );
		expect( metadata.versions[ '8.4' ].packageVersion ).toBe( 'vc-runtime-1' );
	} );

	it( 'records updated artifact metadata for an existing package identifier', () => {
		runUpdater( '1.0.0' );
		writeJson( uploadResultsPath, {
			'php-8.4.22-cli-windows-x86_64.zip': {
				cdn_url: 'https://example.com/8.4.22-1.0.0/replaced',
				sha: 'c'.repeat( 64 ),
			},
		} );

		runUpdater( '1.0.0' );

		const metadata = JSON.parse( fs.readFileSync( metadataPath, 'utf8' ) );
		expect( metadata.versions[ '8.4' ].artifacts[ 'win32-x64' ] ).toEqual( {
			url: 'https://example.com/8.4.22-1.0.0/replaced',
			sha: 'c'.repeat( 64 ),
		} );
	} );
} );
