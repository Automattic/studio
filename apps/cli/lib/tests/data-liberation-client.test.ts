import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { getDataLiberationCliPath, liberateWebsite } from '../data-liberation-client';

const tempDirs: string[] = [];

function createOutput(): { outputBase: string; websiteDir: string } {
	const outputBase = fs.mkdtempSync( path.join( os.tmpdir(), 'studio-liberation-' ) );
	tempDirs.push( outputBase );
	const websiteDir = path.join( outputBase, 'example.com', 'website' );
	fs.mkdirSync( websiteDir, { recursive: true } );
	fs.writeFileSync( path.join( websiteDir, 'index.html' ), '<main>Liberated</main>' );
	fs.writeFileSync(
		path.join( websiteDir, '..', 'capture-receipt.json' ),
		JSON.stringify( {
			schema: 'data-liberation/capture-receipt/v1',
			summary: { routesDiscovered: 1, routesCaptured: 1, routesSkipped: 0, routesFailed: 0 },
		} )
	);
	return { outputBase, websiteDir };
}

afterEach( () => {
	for ( const dir of tempDirs.splice( 0 ) ) {
		fs.rmSync( dir, { recursive: true, force: true } );
	}
} );

describe( 'Data Liberation CLI', () => {
	it( 'points at the vendored Data Liberation CLI', () => {
		const cliPath = getDataLiberationCliPath();
		expect( path.basename( cliPath ) ).toBe( 'cli.js' );
		expect( path.basename( path.dirname( cliPath ) ) ).toBe( 'dist' );
		expect( path.basename( path.dirname( path.dirname( cliPath ) ) ) ).toBe(
			'data-liberation-agent'
		);
	} );

	it( 'returns the portable website directory reported by the CLI', async () => {
		const { outputBase, websiteDir } = createOutput();
		const onProgress = vi.fn();
		const runCli = vi.fn().mockResolvedValue( {
			exitCode: 0,
			signal: null,
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
					signal: null,
					stdout: '',
					stderr: 'Capture failed',
				} ),
			} )
		).rejects.toThrow( 'Capture failed' );
	} );

	it( 'rejects a capture that lost too many routes even when the CLI exits successfully', async () => {
		const { outputBase, websiteDir } = createOutput();
		fs.writeFileSync(
			path.join( websiteDir, '..', 'capture-receipt.json' ),
			JSON.stringify( {
				schema: 'data-liberation/capture-receipt/v1',
				entrypoint: 'website/index.html',
				source: { url: 'https://example.com/' },
				summary: { routesDiscovered: 13, routesCaptured: 7, routesSkipped: 0, routesFailed: 6 },
			} )
		);

		await expect(
			liberateWebsite( 'https://example.com', outputBase, {
				runCli: async () => ( {
					exitCode: 0,
					signal: null,
					stdout: `Liberated 7/13 routes (6 failed)\nSite: ${ websiteDir }\n`,
					stderr: '',
				} ),
			} )
		).rejects.toThrow( /captured 7 of 13 routes and reported 6 capture failures/ );
		expect( fs.existsSync( path.join( websiteDir, 'index.html' ) ) ).toBe( true );
	} );

	it( 'imports a capture that lost a few routes and reports them', async () => {
		const { outputBase, websiteDir } = createOutput();
		fs.writeFileSync(
			path.join( websiteDir, '..', 'capture-receipt.json' ),
			JSON.stringify( {
				schema: 'data-liberation/capture-receipt/v1',
				entrypoint: 'website/index.html',
				source: { url: 'https://example.com/' },
				discoveryDiagnostics: [
					{ code: 'route_capture_failed', url: 'https://example.com/contact', reason: 'HTTP 500' },
					{ code: 'route_not_found', url: 'https://example.com/old', reason: 'HTTP 404' },
				],
				summary: { routesDiscovered: 14, routesCaptured: 13, routesSkipped: 0, routesFailed: 1 },
			} )
		);
		const onPartialCapture = vi.fn();

		await expect(
			liberateWebsite( 'https://example.com', outputBase, {
				onPartialCapture,
				runCli: async () => ( {
					exitCode: 0,
					signal: null,
					stdout: `Site: ${ websiteDir }\n`,
					stderr: '',
				} ),
			} )
		).resolves.toBe( websiteDir );
		expect( onPartialCapture ).toHaveBeenCalledWith( {
			routesDiscovered: 14,
			routesFailed: 1,
			failedRoutes: [ { url: 'https://example.com/contact', reason: 'HTTP 500' } ],
			diagnosticsPath: path.join( websiteDir, '..', 'diagnostics.json' ),
		} );
	} );

	it( 'rejects a capture whose entry route failed', async () => {
		const { outputBase, websiteDir } = createOutput();
		fs.writeFileSync(
			path.join( websiteDir, '..', 'capture-receipt.json' ),
			JSON.stringify( {
				schema: 'data-liberation/capture-receipt/v1',
				entrypoint: 'website/index.html',
				source: { url: 'https://example.com/' },
				discoveryDiagnostics: [
					{ code: 'route_capture_failed', url: 'https://example.com', reason: 'HTTP 503' },
				],
				summary: { routesDiscovered: 14, routesCaptured: 13, routesSkipped: 0, routesFailed: 1 },
			} )
		);
		const onPartialCapture = vi.fn();

		await expect(
			liberateWebsite( 'https://example.com', outputBase, {
				onPartialCapture,
				runCli: async () => ( {
					exitCode: 0,
					signal: null,
					stdout: `Site: ${ websiteDir }\n`,
					stderr: '',
				} ),
			} )
		).rejects.toThrow( /could not capture the entry route/ );
		expect( onPartialCapture ).not.toHaveBeenCalled();
	} );

	it( 'rejects a capture whose entrypoint document is missing', async () => {
		const { outputBase, websiteDir } = createOutput();
		fs.rmSync( path.join( websiteDir, 'index.html' ) );
		fs.writeFileSync(
			path.join( websiteDir, '..', 'capture-receipt.json' ),
			JSON.stringify( {
				schema: 'data-liberation/capture-receipt/v1',
				entrypoint: 'website/index.html',
				source: { url: 'https://example.com/' },
				summary: { routesDiscovered: 14, routesCaptured: 13, routesSkipped: 0, routesFailed: 1 },
			} )
		);

		await expect(
			liberateWebsite( 'https://example.com', outputBase, {
				runCli: async () => ( {
					exitCode: 0,
					signal: null,
					stdout: `Site: ${ websiteDir }\n`,
					stderr: '',
				} ),
			} )
		).rejects.toThrow( /could not capture the entry route/ );
	} );

	it.each( [ null, '{', JSON.stringify( { summary: { routesFailed: 0 } } ) ] )(
		'rejects a missing or invalid capture receipt: %s',
		async ( receipt ) => {
			const { outputBase, websiteDir } = createOutput();
			const receiptPath = path.join( websiteDir, '..', 'capture-receipt.json' );
			if ( receipt === null ) {
				fs.rmSync( receiptPath );
			} else {
				fs.writeFileSync( receiptPath, receipt );
			}

			await expect(
				liberateWebsite( 'https://example.com', outputBase, {
					runCli: async () => ( {
						exitCode: 0,
						signal: null,
						stdout: `Site: ${ websiteDir }\n`,
						stderr: '',
					} ),
				} )
			).rejects.toThrow( /capture receipt/ );
		}
	);

	it( 'reports the signal that terminated the CLI instead of progress output', async () => {
		const { outputBase } = createOutput();

		await expect(
			liberateWebsite( 'https://example.com', outputBase, {
				runCli: vi.fn().mockResolvedValue( {
					exitCode: null,
					signal: 'SIGTERM',
					stdout: '',
					stderr: '[liberate] finalizing',
				} ),
			} )
		).rejects.toThrow( 'terminated by SIGTERM' );
	} );

	it( 'rejects a website directory outside its output base', async () => {
		const { outputBase } = createOutput();
		const outsideDir = fs.mkdtempSync( path.join( os.tmpdir(), 'studio-liberation-outside-' ) );
		tempDirs.push( outsideDir );

		await expect(
			liberateWebsite( 'https://example.com', outputBase, {
				runCli: vi.fn().mockResolvedValue( {
					exitCode: 0,
					signal: null,
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
