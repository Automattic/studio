import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { liberateWebsite } from '../data-liberation-client';

const tempDirs: string[] = [];

function createOutput(): { outputBase: string; websiteDir: string } {
	const outputBase = fs.mkdtempSync( path.join( os.tmpdir(), 'studio-liberation-' ) );
	tempDirs.push( outputBase );
	const websiteDir = path.join( outputBase, 'example.com', 'website' );
	fs.mkdirSync( websiteDir, { recursive: true } );
	fs.writeFileSync( path.join( websiteDir, 'index.html' ), '<main>Liberated</main>' );
	return { outputBase, websiteDir };
}

afterEach( () => {
	for ( const dir of tempDirs.splice( 0 ) ) {
		fs.rmSync( dir, { recursive: true, force: true } );
	}
} );

describe( 'Data Liberation CLI', () => {
	it( 'returns the portable website directory reported by the CLI', async () => {
		const { outputBase, websiteDir } = createOutput();
		const onProgress = vi.fn();
		const runCli = vi.fn().mockResolvedValue( {
			exitCode: 0,
			stdout: `Liberated 1/1 routes\nSite: ${ websiteDir }\n`,
			stderr: '',
		} );

		await expect(
			liberateWebsite( 'https://example.com', outputBase, { runCli, onProgress } )
		).resolves.toBe( websiteDir );
		expect( runCli ).toHaveBeenCalledWith(
			[ 'https://example.com/', '--output', outputBase, '--resume' ],
			onProgress
		);
	} );

	it( 'surfaces CLI failures', async () => {
		const { outputBase } = createOutput();

		await expect(
			liberateWebsite( 'https://example.com', outputBase, {
				runCli: vi.fn().mockResolvedValue( {
					exitCode: 1,
					stdout: '',
					stderr: 'Capture failed',
				} ),
			} )
		).rejects.toThrow( 'Capture failed' );
	} );

	it( 'rejects a website directory outside its output base', async () => {
		const { outputBase } = createOutput();
		const outsideDir = fs.mkdtempSync( path.join( os.tmpdir(), 'studio-liberation-outside-' ) );
		tempDirs.push( outsideDir );

		await expect(
			liberateWebsite( 'https://example.com', outputBase, {
				runCli: vi.fn().mockResolvedValue( {
					exitCode: 0,
					stdout: `Site: ${ outsideDir }\n`,
					stderr: '',
				} ),
			} )
		).rejects.toThrow( 'invalid website directory' );
	} );

	it( 'rejects non-HTTP sources before invoking the CLI', async () => {
		const runCli = vi.fn();

		await expect(
			liberateWebsite( 'file:///tmp/index.html', '/tmp/capture', { runCli } )
		).rejects.toThrow( 'HTTP or HTTPS' );
		expect( runCli ).not.toHaveBeenCalled();
	} );
} );
