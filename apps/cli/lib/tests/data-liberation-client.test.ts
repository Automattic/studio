import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
	compareLiberatedCapture,
	getDataLiberationCliPath,
	liberateWebsite,
} from '../data-liberation-client';

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

function writeReceipt( websiteDir: string, receipt: Record< string, unknown > ): void {
	fs.writeFileSync(
		path.join( websiteDir, '..', 'capture-receipt.json' ),
		JSON.stringify( {
			schema: 'data-liberation/capture-receipt/v1',
			entrypoint: 'website/index.html',
			source: { url: 'https://example.com/' },
			...receipt,
		} )
	);
}

function droppedRouteDiagnostics( count: number ) {
	return Array.from( { length: count }, ( _value, index ) => ( {
		code: 'route_capture_failed',
		url: `https://example.com/page-${ index }`,
		reason: 'HTTP 500',
	} ) );
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
		writeReceipt( websiteDir, {
			discoveryDiagnostics: droppedRouteDiagnostics( 6 ),
			summary: { routesDiscovered: 13, routesCaptured: 7, routesSkipped: 0, routesFailed: 12 },
		} );

		await expect(
			liberateWebsite( 'https://example.com', outputBase, {
				runCli: async () => ( {
					exitCode: 0,
					signal: null,
					stdout: `Liberated 7/13 routes (6 failed)\nSite: ${ websiteDir }\n`,
					stderr: '',
				} ),
			} )
		).rejects.toThrow( /could not capture 6 of 13 routes/ );
		expect( fs.existsSync( path.join( websiteDir, 'index.html' ) ) ).toBe( true );
	} );

	// One dead route fails once per captured viewport, so `routesFailed` overcounts the routes
	// that are actually missing. The gate has to weigh the routes, not the failure records.
	it( 'imports a capture that lost a single route and reports it', async () => {
		const { outputBase, websiteDir } = createOutput();
		writeReceipt( websiteDir, {
			discoveryDiagnostics: [
				{ code: 'route_capture_failed', url: 'https://example.com/contact', reason: 'HTTP 500' },
				{ code: 'route_not_found', url: 'https://example.com/old', reason: 'HTTP 404' },
			],
			summary: { routesDiscovered: 14, routesCaptured: 13, routesSkipped: 0, routesFailed: 2 },
		} );
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
			droppedRoutes: [ { url: 'https://example.com/contact', reason: 'HTTP 500' } ],
			diagnosticsPath: path.join( websiteDir, '..', 'diagnostics.json' ),
		} );
	} );

	it.each( [
		{ dropped: 2, imports: true },
		{ dropped: 3, imports: false },
	] )( 'imports $dropped of 20 dropped routes: $imports', async ( { dropped, imports } ) => {
		const { outputBase, websiteDir } = createOutput();
		writeReceipt( websiteDir, {
			discoveryDiagnostics: droppedRouteDiagnostics( dropped ),
			summary: {
				routesDiscovered: 20,
				routesCaptured: 20 - dropped,
				routesSkipped: 0,
				routesFailed: dropped * 2,
			},
		} );
		const run = liberateWebsite( 'https://example.com', outputBase, {
			runCli: async () => ( {
				exitCode: 0,
				signal: null,
				stdout: `Site: ${ websiteDir }\n`,
				stderr: '',
			} ),
		} );

		if ( imports ) {
			await expect( run ).resolves.toBe( websiteDir );
		} else {
			await expect( run ).rejects.toThrow( /could not capture 3 of 20 routes/ );
		}
	} );

	it( 'rejects a capture whose entry route failed', async () => {
		const { outputBase, websiteDir } = createOutput();
		writeReceipt( websiteDir, {
			discoveryDiagnostics: [
				{ code: 'route_capture_failed', url: 'https://example.com', reason: 'HTTP 503' },
			],
			summary: { routesDiscovered: 14, routesCaptured: 13, routesSkipped: 0, routesFailed: 2 },
		} );
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

	it( 'does not mistake a query-routed page for the entry route', async () => {
		const { outputBase, websiteDir } = createOutput();
		writeReceipt( websiteDir, {
			discoveryDiagnostics: [
				{ code: 'route_capture_failed', url: 'https://example.com/?p=12', reason: 'HTTP 500' },
			],
			summary: { routesDiscovered: 14, routesCaptured: 13, routesSkipped: 0, routesFailed: 2 },
		} );

		await expect(
			liberateWebsite( 'https://example.com', outputBase, {
				runCli: async () => ( {
					exitCode: 0,
					signal: null,
					stdout: `Site: ${ websiteDir }\n`,
					stderr: '',
				} ),
			} )
		).resolves.toBe( websiteDir );
	} );

	it( 'rejects a capture whose entrypoint document is missing', async () => {
		const { outputBase, websiteDir } = createOutput();
		fs.rmSync( path.join( websiteDir, 'index.html' ) );
		writeReceipt( websiteDir, {
			discoveryDiagnostics: droppedRouteDiagnostics( 1 ),
			summary: { routesDiscovered: 14, routesCaptured: 13, routesSkipped: 0, routesFailed: 2 },
		} );

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

	it( 'rejects capture failures reported without per-route diagnostics', async () => {
		const { outputBase, websiteDir } = createOutput();
		writeReceipt( websiteDir, {
			summary: { routesDiscovered: 14, routesCaptured: 13, routesSkipped: 0, routesFailed: 2 },
		} );

		await expect(
			liberateWebsite( 'https://example.com', outputBase, {
				runCli: async () => ( {
					exitCode: 0,
					signal: null,
					stdout: `Site: ${ websiteDir }\n`,
					stderr: '',
				} ),
			} )
		).rejects.toThrow( /without per-route diagnostics/ );
	} );

	it( 'imports a capture whose failures did not drop a route', async () => {
		const { outputBase, websiteDir } = createOutput();
		writeReceipt( websiteDir, {
			discoveryDiagnostics: [
				{ code: 'route_not_found', url: 'https://example.com/old', reason: 'HTTP 404' },
			],
			summary: { routesDiscovered: 14, routesCaptured: 13, routesSkipped: 1, routesFailed: 2 },
		} );
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
		expect( onPartialCapture ).not.toHaveBeenCalled();
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

describe( 'compareLiberatedCapture', () => {
	it( 'invokes `compare <dir>` and reports a passing verdict', async () => {
		const runCli = vi.fn().mockResolvedValue( {
			exitCode: 0,
			signal: null,
			stdout:
				'self-consistency ok across 1 route(s)\nPassed: 1 route(s), against https://example.com/\n',
			stderr: '[compare] / @ 1600px\n',
		} );
		const onProgress = vi.fn();

		await expect(
			compareLiberatedCapture( '/tmp/capture', { runCli, onProgress } )
		).resolves.toEqual( {
			pass: true,
			report:
				'self-consistency ok across 1 route(s)\nPassed: 1 route(s), against https://example.com/',
		} );
		expect( runCli ).toHaveBeenCalledWith( [ 'compare', '/tmp/capture' ], onProgress );
	} );

	// DLA's own exit code is the pass/fail signal — stdout content is a report to relay to
	// the user, not something this client re-derives a verdict from.
	it( 'reports a failing verdict from a non-zero exit code', async () => {
		const runCli = vi.fn().mockResolvedValue( {
			exitCode: 1,
			signal: null,
			stdout: 'Failed 1 source check(s): 1 route(s), against https://example.com/\n',
			stderr: '',
		} );

		await expect( compareLiberatedCapture( '/tmp/capture', { runCli } ) ).resolves.toEqual( {
			pass: false,
			report: 'Failed 1 source check(s): 1 route(s), against https://example.com/',
		} );
	} );

	it( 'reports the signal that terminated the CLI', async () => {
		const runCli = vi.fn().mockResolvedValue( {
			exitCode: null,
			signal: 'SIGTERM',
			stdout: '',
			stderr: '[compare] / @ 1600px',
		} );

		await expect( compareLiberatedCapture( '/tmp/capture', { runCli } ) ).rejects.toThrow(
			'terminated by SIGTERM'
		);
	} );

	it( 'rejects a run that produced no output at all', async () => {
		const runCli = vi.fn().mockResolvedValue( {
			exitCode: 1,
			signal: null,
			stdout: '',
			stderr: '',
		} );

		await expect( compareLiberatedCapture( '/tmp/capture', { runCli } ) ).rejects.toThrow(
			'produced no output'
		);
	} );
} );
