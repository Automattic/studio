import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createWebsiteArtifact } from '../data-liberation-client';

const dirs: string[] = [];

afterEach( () => {
	for ( const dir of dirs.splice( 0 ) ) fs.rmSync( dir, { recursive: true, force: true } );
} );

describe( 'Data Liberation browser capture', () => {
	it( 'returns the artifact path emitted by Data Liberation', async () => {
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
		const runCapture = vi.fn().mockResolvedValue( { artifactPath } );

		await expect(
			createWebsiteArtifact( 'https://example.com', outputDir, { runCapture } )
		).resolves.toBe( artifactPath );
		expect( runCapture ).toHaveBeenCalledWith( {
			url: 'https://example.com/',
			outputDir,
			resume: true,
			captureImages: false,
			learnFluid: true,
			onProgress: undefined,
		} );
	} );

	it( 'rejects non-HTTP sources before acquisition', async () => {
		await expect(
			createWebsiteArtifact( 'file:///tmp/index.html', '/tmp/capture' )
		).rejects.toThrow( 'HTTP or HTTPS' );
	} );

	it( 'rejects a missing artifact returned by Data Liberation', async () => {
		const outputDir = fs.mkdtempSync( path.join( os.tmpdir(), 'studio-capture-' ) );
		dirs.push( outputDir );
		const artifactPath = path.join( outputDir, 'artifact.json' );

		await expect(
			createWebsiteArtifact( 'https://example.com', outputDir, {
				runCapture: vi.fn().mockResolvedValue( { artifactPath } ),
			} )
		).rejects.toThrow( 'without a website artifact' );
	} );
} );
