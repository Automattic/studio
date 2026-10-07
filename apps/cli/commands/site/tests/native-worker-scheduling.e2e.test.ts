/** @vitest-environment node */
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { chromium } from '@playwright/test';
import nock from 'nock';
import { describe, expect, it } from 'vitest';
import {
	cleanupCliEnv,
	cliE2ePrerequisitesMet,
	readCliConfig,
	runCli,
	setupCliEnv,
} from './helpers/cli-e2e';
import type { AddressInfo } from 'node:net';

describe.skipIf( ! cliE2ePrerequisitesMet() )( 'native PHP worker scheduling', () => {
	it.for( [ false, true ] )(
		'finishes stylesheets while the primary worker is occupied (caller disconnected: %s)',
		{ tags: [ 'e2e' ], timeout: 180_000 },
		async ( disconnect ) => {
			nock.enableNetConnect( /^(localhost|127\.0\.0\.1)/ );
			const env = setupCliEnv();
			let openGate: http.ServerResponse | undefined;
			let enteredGate!: () => void;
			let rejectGate!: ( error: Error ) => void;
			const gateEntered = new Promise< void >( ( resolve, reject ) => {
				enteredGate = resolve;
				rejectGate = reject;
			} );
			const gate = http.createServer( ( _req, res ) => {
				openGate = res;
				enteredGate();
			} );
			await new Promise< void >( ( resolve ) => gate.listen( 0, '127.0.0.1', resolve ) );
			let browser: Awaited< ReturnType< typeof chromium.launch > > | undefined;
			let background: http.ClientRequest | undefined;
			try {
				const sitePath = path.join( env.sitesDir, 'worker-scheduling' );
				const created = await runCli(
					[ 'site', 'create', '--path', sitePath, '--skip-browser', '--skip-log-details' ],
					env
				);
				expect( created.code, created.stderr ).toBe( 0 );
				const [ site ] = readCliConfig( env ).sites;
				const url = `http://localhost:${ String( site.port ) }`;
				const fixture = path.join( sitePath, 'wp-content', 'worker-fixture' );
				fs.mkdirSync( fixture );
				fs.writeFileSync( path.join( fixture, 'available.php' ), '<?php echo "available";' );
				fs.writeFileSync(
					path.join( fixture, 'background.php' ),
					`<?php
ignore_user_abort(true);
$curl = curl_init('http://127.0.0.1:${ ( gate.address() as AddressInfo ).port }/gate');
curl_setopt_array($curl, [CURLOPT_RETURNTRANSFER => true, CURLOPT_TIMEOUT => 120]);
curl_exec($curl);
curl_close($curl);
echo str_repeat('done', 131072);
`
				);
				const links = Array.from( { length: 64 }, ( _, index ) => {
					fs.writeFileSync(
						path.join( fixture, `${ index }.css` ),
						`html { --sheet-${ index }: loaded; }`
					);
					return `<link rel="stylesheet" href="${ index }.css">`;
				} );
				fs.writeFileSync(
					path.join( fixture, 'head.js' ),
					`window.loadedSheets = Array.from({length:64}, (_, i) => getComputedStyle(document.documentElement).getPropertyValue('--sheet-' + i).trim()).filter(value => value === 'loaded').length;`
				);
				fs.writeFileSync(
					path.join( fixture, 'index.html' ),
					`<!doctype html><html><head>${ links.join(
						''
					) }<script src="head.js"></script></head><body>Stylesheets loaded</body></html>`
				);
				background = http.request(
					`${ url }/wp-content/worker-fixture/background.php`,
					{ method: 'POST' },
					( response ) => response.resume()
				);
				background.on( 'error', rejectGate );
				background.end();
				const gateDeadline = setTimeout(
					() => rejectGate( new Error( 'PHP did not reach the gate' ) ),
					10_000
				);
				try {
					await gateEntered;
				} finally {
					clearTimeout( gateDeadline );
				}
				if ( disconnect ) {
					await new Promise< void >( ( resolve ) => {
						background!.once( 'close', resolve );
						background!.destroy();
					} );
				}

				browser = await chromium.launch();
				const page = await browser.newPage();
				const finished = new Set< string >();
				const pending = new Set< string >();
				const failures: string[] = [];
				page.on( 'request', ( request ) => {
					if ( request.url().endsWith( '.css' ) ) pending.add( request.url() );
				} );
				page.on( 'requestfinished', ( request ) => {
					if ( request.url().endsWith( '.css' ) ) {
						finished.add( request.url() );
						pending.delete( request.url() );
					}
				} );
				page.on( 'requestfailed', ( request ) => failures.push( request.url() ) );
				try {
					await page.goto( `${ url }/wp-content/worker-fixture/index.html`, {
						waitUntil: 'load',
						timeout: 5000,
					} );
				} catch ( error ) {
					const state = disconnect
						? { stage: 'navigation before commit' }
						: await page.evaluate( () => ( {
								ready: document.readyState,
								body: !! document.body,
						  } ) );
					throw new Error(
						`${ JSON.stringify( {
							...state,
							pending: [ ...pending ],
							finished: finished.size,
						} ) }: ${ String( error ) }`
					);
				}
				expect( await page.locator( 'body' ).innerText() ).toBe( 'Stylesheets loaded' );
				expect( await page.evaluate( 'window.loadedSheets' ) ).toBe( 64 );
				expect( finished.size ).toBe( 64 );
				expect( failures ).toEqual( [] );
				openGate!.end( 'released' );
				const available = await fetch( `${ url }/wp-content/worker-fixture/available.php`, {
					method: 'POST',
					signal: AbortSignal.timeout( 5000 ),
				} );
				expect( await available.text() ).toBe( 'available' );
			} finally {
				openGate?.end( 'released' );
				background?.destroy();
				await browser?.close();
				await runCli( [ 'site', 'stop', '--all' ], env );
				await new Promise< void >( ( resolve ) => gate.close( () => resolve() ) );
				cleanupCliEnv( env );
			}
		}
	);
} );
