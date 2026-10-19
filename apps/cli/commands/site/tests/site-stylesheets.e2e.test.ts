/** @vitest-environment node */
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { chromium } from '@playwright/test';
import { describe, expect, it } from 'vitest';
import {
	cleanupCliEnv,
	cliE2ePrerequisitesMet,
	readCliConfig,
	runCli,
	setupCliEnv,
} from './helpers/cli-e2e';
import type { AddressInfo } from 'node:net';

describe.skipIf( ! cliE2ePrerequisitesMet() )( 'CLI e2e: stylesheet transport', () => {
	it.each( [ 'native', 'sandbox' ] )(
		'%s avoids an IPv4 port collision and completes stylesheets before a classic head script',
		{ tags: [ 'e2e' ], timeout: 240_000 },
		async ( runtime ) => {
			const env = setupCliEnv();
			const competingServer = http.createServer( ( _req, res ) => res.end( 'Other site' ) );
			await new Promise< void >( ( resolve ) => competingServer.listen( 0, '127.0.0.1', resolve ) );
			const occupiedPort = ( competingServer.address() as AddressInfo ).port;
			const previousBasePort = process.env.STUDIO_BASE_PORT;
			process.env.STUDIO_BASE_PORT = String( occupiedPort );
			let browser: Awaited< ReturnType< typeof chromium.launch > > | undefined;

			try {
				const sitePath = path.join( env.sitesDir, runtime );
				const created = await runCli(
					[
						'site',
						'create',
						'--path',
						sitePath,
						'--runtime',
						runtime,
						'--skip-browser',
						'--skip-log-details',
					],
					env
				);
				expect( created.code, created.stderr ).toBe( 0 );
				const [ site ] = readCliConfig( env ).sites;
				expect( site.runtime ).toBe( runtime === 'native' ? 'native-php' : 'playground' );
				expect( Number( site.port ) ).toBeGreaterThan( occupiedPort );

				const fixture = path.join( sitePath, 'wp-content', 'stylesheet-fixture' );
				fs.mkdirSync( fixture );
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

				browser = await chromium.launch();
				const page = await browser.newPage();
				const finished = new Set< string >();
				const failed: string[] = [];
				page.on( 'requestfinished', ( request ) => {
					if ( request.url().endsWith( '.css' ) ) {
						finished.add( request.url() );
					}
				} );
				page.on( 'requestfailed', ( request ) => failed.push( request.url() ) );
				await page.goto(
					`http://localhost:${ String( site.port ) }/wp-content/stylesheet-fixture/index.html`,
					{
						waitUntil: 'load',
						timeout: 15_000,
					}
				);
				expect( await page.locator( 'body' ).innerText() ).toBe( 'Stylesheets loaded' );
				expect( await page.evaluate( 'window.loadedSheets' ) ).toBe( 64 );
				expect( finished.size ).toBe( 64 );
				expect( failed ).toEqual( [] );
			} finally {
				await browser?.close();
				if ( previousBasePort === undefined ) {
					delete process.env.STUDIO_BASE_PORT;
				} else {
					process.env.STUDIO_BASE_PORT = previousBasePort;
				}
				await runCli( [ 'site', 'stop', '--all' ], env );
				await new Promise< void >( ( resolve ) => competingServer.close( () => resolve() ) );
				cleanupCliEnv( env );
			}
		}
	);
} );
