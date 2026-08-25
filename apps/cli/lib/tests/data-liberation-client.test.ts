import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { captureProgressMessage, captureWebsite } from '../data-liberation-client';

const dirs: string[] = [];

afterEach( () => {
	for ( const dir of dirs.splice( 0 ) ) fs.rmSync( dir, { recursive: true, force: true } );
} );

describe( 'Data Liberation browser capture', () => {
	it( 'reports bounded capture counts with elapsed timing', () => {
		expect(
			captureProgressMessage( {
				phase: 'capturing',
				current: 7,
				total: 20,
				elapsedMs: 65_999,
			} )
		).toBe( 'Capture: route 7 of 20… 65 sec elapsed' );
		expect( captureProgressMessage( { phase: 'finalizing', elapsedMs: 70_000 } ) ).toBe(
			'Capture: finalizing website artifact… 70 sec elapsed'
		);
	} );

	it( 'returns the canonical artifact emitted by Data Liberation', async () => {
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
		const capture = vi.fn().mockResolvedValue( {
			artifactPath,
			provenance: { provider: 'data-liberation/browser-capture', platform: 'wix' },
		} );

		await expect(
			captureWebsite( 'https://example.com', outputDir, { resume: true, capture } )
		).resolves.toEqual( {
			artifactPath,
			outputDir,
			provenance: { provider: 'data-liberation/browser-capture', platform: 'wix' },
		} );
		expect( capture ).toHaveBeenCalledWith( {
			url: 'https://example.com/',
			outputDir,
			resume: true,
			captureImages: false,
			onProgress: undefined,
		} );
	} );

	it( 'rejects non-HTTP sources before acquisition', async () => {
		await expect( captureWebsite( 'file:///tmp/index.html', '/tmp/capture' ) ).rejects.toThrow(
			'HTTP or HTTPS'
		);
	} );

	it( 'rejects a malformed artifact returned by Data Liberation', async () => {
		const outputDir = fs.mkdtempSync( path.join( os.tmpdir(), 'studio-capture-' ) );
		dirs.push( outputDir );
		const artifactPath = path.join( outputDir, 'artifact.json' );
		fs.writeFileSync( artifactPath, '{"schema":"unexpected"}' );

		await expect(
			captureWebsite( 'https://example.com', outputDir, {
				capture: vi.fn().mockResolvedValue( { artifactPath } ),
			} )
		).rejects.toThrow( 'invalid website artifact' );
	} );

	it( 'validates a bounded capture receipt without loading the portable artifact', async () => {
		const outputDir = fs.mkdtempSync( path.join( os.tmpdir(), 'studio-capture-' ) );
		dirs.push( outputDir );
		const artifactPath = path.join( outputDir, 'artifact.json' );
		const captureReceiptPath = path.join( outputDir, 'capture-receipt.json' );
		fs.writeFileSync( artifactPath, 'portable artifact is consumed by the importer' );
		fs.writeFileSync(
			captureReceiptPath,
			JSON.stringify( {
				schema: 'data-liberation/capture-receipt/v1',
				entrypoint: 'website/index.html',
				routes: [ { path: 'website/index.html' } ],
			} )
		);

		await expect(
			captureWebsite( 'https://example.com', outputDir, {
				capture: vi.fn().mockResolvedValue( { artifactPath, captureReceiptPath } ),
			} )
		).resolves.toMatchObject( { artifactPath, outputDir } );
	} );
} );
