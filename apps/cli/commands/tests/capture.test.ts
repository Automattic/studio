import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { captureUrl } from '../capture';

const dirs: string[] = [];

afterEach( () => {
	for ( const dir of dirs.splice( 0 ) ) fs.rmSync( dir, { recursive: true, force: true } );
} );

describe( 'CLI: studio capture', () => {
	it( 'returns the canonical artifact emitted by the acquisition engine', async () => {
		const outputDir = fs.mkdtempSync( path.join( os.tmpdir(), 'studio-capture-' ) );
		dirs.push( outputDir );
		const artifactPath = path.join( outputDir, 'artifact.json' );
		fs.writeFileSync(
			artifactPath,
			JSON.stringify( {
				schema: 'blocks-engine/php-transformer/site-artifact/v1',
				entrypoint: 'website/index.html',
				files: [ { path: 'website/index.html', content: '<main>Captured</main>' } ],
			} )
		);
		const callTool = vi.fn().mockResolvedValue( {
			artifactPath,
			provenance: { provider: 'data-liberation/browser-capture', platform: 'wix' },
		} );

		await expect(
			captureUrl( 'https://example.com', outputDir, { resume: true, callTool } )
		).resolves.toEqual( {
			artifactPath,
			outputDir,
			provenance: { provider: 'data-liberation/browser-capture', platform: 'wix' },
		} );
		expect( callTool ).toHaveBeenCalledWith( 'liberate_capture', {
			url: 'https://example.com/',
			outputDir,
			resume: true,
		} );
	} );

	it( 'rejects non-HTTP sources before acquisition', async () => {
		await expect( captureUrl( 'file:///tmp/index.html', '/tmp/capture' ) ).rejects.toThrow(
			'HTTP or HTTPS'
		);
	} );

	it( 'rejects a malformed artifact returned by the acquisition engine', async () => {
		const outputDir = fs.mkdtempSync( path.join( os.tmpdir(), 'studio-capture-' ) );
		dirs.push( outputDir );
		const artifactPath = path.join( outputDir, 'artifact.json' );
		fs.writeFileSync( artifactPath, '{"schema":"unexpected"}' );

		await expect(
			captureUrl( 'https://example.com', outputDir, {
				callTool: vi.fn().mockResolvedValue( { artifactPath } ),
			} )
		).rejects.toThrow( 'invalid website artifact' );
	} );
} );
