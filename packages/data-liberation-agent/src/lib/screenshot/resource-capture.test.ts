import { EventEmitter } from 'node:events';
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	statSync,
	writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as cheerio from 'cheerio';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { exportWebsiteCapture } from '../capture-export.js';
import {
	CAPTURED_RESOURCE_TIMEOUT_CEILING_MS,
	CAPTURED_RESOURCE_TIMEOUT_MS,
	CapturedResourceStore,
	MAX_CAPTURED_RESOURCE_TOTAL_BYTES,
	MAX_CAPTURED_VIDEO_RESOURCE_BYTES,
	resourceTimeoutMs,
} from './resource-capture.js';

const dirs: string[] = [];

afterEach( () => {
	vi.useRealTimers();
	for ( const dir of dirs.splice( 0 ) ) rmSync( dir, { recursive: true, force: true } );
} );

describe( 'CapturedResourceStore', () => {
	it( 'replays only fresh static responses with response semantics intact', async () => {
		vi.useFakeTimers();
		vi.setSystemTime( new Date( '2026-08-29T00:00:00Z' ) );
		const outputDir = mkdtempSync( join( tmpdir(), 'dla-resources-' ) );
		dirs.push( outputDir );
		const page = new EventEmitter();
		const store = new CapturedResourceStore( outputDir, 'https://example.com/' );
		store.observe( page as never );

		for ( const [ url, resourceType, cacheControl, vary ] of [
			[ 'https://example.com/assets/app.js', 'script', 'public, max-age=3600', 'Accept-Encoding' ],
			[ 'https://example.com/api/data', 'fetch', 'public, max-age=3600', '' ],
			[ 'https://example.com/styles/private.css', 'stylesheet', 'no-store', '' ],
			[ 'https://example.com/styles/context.css', 'stylesheet', 'private, max-age=3600', '' ],
			[ 'https://example.com/images/variant.jpg', 'image', 'public, max-age=3600', 'User-Agent' ],
		] ) {
			page.emit( 'response', {
				url: () => url,
				status: () => 200,
				headers: () => ( {
					'content-type': resourceType === 'stylesheet' ? 'text/css' : 'application/octet-stream',
					'cache-control': cacheControl,
					'access-control-allow-origin': 'https://example.com',
					vary,
				} ),
				body: vi.fn().mockResolvedValue( Buffer.from( url ) ),
				request: () => ( { resourceType: () => resourceType } ),
			} );
		}

		await store.settle( page as never );
		const replay = store.getReplayableResponse(
			'https://example.com/assets/app.js',
			'script'
		);
		expect( replay ).toEqual( {
			path: join( outputDir, 'resources', 'assets', 'app.js' ),
			contentType: 'application/octet-stream',
			headers: { 'access-control-allow-origin': 'https://example.com' },
		} );
		expect( readFileSync( replay!.path, 'utf8' ) ).toBe(
			'https://example.com/assets/app.js'
		);
		vi.setSystemTime( new Date( '2026-08-29T01:00:01Z' ) );
		expect(
			store.getReplayableResponse( 'https://example.com/assets/app.js', 'script' )
		).toBeUndefined();
		expect(
			store.getReplayableResponse( 'https://example.com/api/data', 'fetch' )
		).toBeUndefined();
		expect(
			store.getReplayableResponse( 'https://example.com/styles/private.css', 'stylesheet' )
		).toBeUndefined();
		expect(
			store.getReplayableResponse( 'https://example.com/styles/context.css', 'stylesheet' )
		).toBeUndefined();
		expect(
			store.getReplayableResponse( 'https://example.com/images/variant.jpg', 'image' )
		).toBeUndefined();
	} );

	it( 'captures same-origin runtime dependencies and records failed responses', async () => {
		const outputDir = mkdtempSync( join( tmpdir(), 'dla-resources-' ) );
		dirs.push( outputDir );
		const page = new EventEmitter();
		const fetchMedia = vi.fn( async ( url: string ) => ( {
			finalUrl: url,
			status: 200,
			headers: new Headers( { 'content-type': 'video/mp4', 'content-length': '5' } ),
			body: Buffer.from( 'video' ),
		} ) );
		const store = new CapturedResourceStore( outputDir, 'https://example.com/', fetchMedia );
		store.observe( page as never );

		page.emit( 'response', {
			url: () => 'https://example.com/_runtimes/site.js',
			ok: () => true,
			status: () => 200,
			headers: () => ( { 'content-type': 'text/javascript' } ),
			body: vi.fn().mockResolvedValue( Buffer.from( 'export const site = true;' ) ),
			request: () => ( { resourceType: () => 'script', method: () => 'GET' } ),
		} );
		page.emit( 'response', {
			url: () => 'https://example.com/_json/site.json',
			ok: () => true,
			status: () => 200,
			headers: () => ( { 'content-type': 'application/json' } ),
			body: vi.fn().mockResolvedValue( Buffer.from( '{"site":true}' ) ),
			request: () => ( { resourceType: () => 'fetch' } ),
		} );
		page.emit( 'response', {
			url: () => 'https://example.com/_videos/hero',
			ok: () => true,
			status: () => 200,
			headers: () => ( { 'content-type': 'video/mp4', 'content-length': '5' } ),
			body: vi.fn().mockResolvedValue( Buffer.from( 'video' ) ),
			request: () => ( { resourceType: () => 'media' } ),
		} );
		page.emit( 'response', {
			url: () => 'https://example.com/styles/site.css',
			ok: () => false,
			status: () => 404,
			headers: () => ( {} ),
			body: vi.fn(),
			request: () => ( { resourceType: () => 'stylesheet' } ),
		} );
		page.emit( 'response', {
			url: () => 'https://cdn.example.com/external.js',
			ok: () => true,
			status: () => 200,
			headers: () => ( {} ),
			body: vi.fn(),
			request: () => ( { resourceType: () => 'script', method: () => 'GET' } ),
		} );

		await store.settle( page as never );
		await store.flush();

		const manifest = JSON.parse(
			readFileSync( join( outputDir, 'resources', 'manifest.json' ), 'utf8' )
		);
		expect( manifest.resources ).toEqual( {
			'https://example.com/_runtimes/site.js': {
				path: 'resources/_runtimes/site.js',
				contentType: 'text/javascript',
			},
			'https://example.com/_json/site.json': {
				path: 'resources/_json/site.json',
				contentType: 'application/json',
			},
			'https://example.com/_videos/hero': {
				path: 'resources/_videos/hero.mp4',
				contentType: 'video/mp4',
			},
		} );
		expect( manifest.failures ).toEqual( [
			{ url: 'https://example.com/styles/site.css', error: 'HTTP 404' },
		] );
		expect( fetchMedia ).toHaveBeenCalledWith(
			'https://example.com/_videos/hero',
			expect.any( Number ),
			expect.any( Number )
		);
		expect( readFileSync( join( outputDir, 'resources', '_runtimes', 'site.js' ), 'utf8' ) ).toBe(
			'export const site = true;'
		);
		expect( readFileSync( join( outputDir, 'resources', '_json', 'site.json' ), 'utf8' ) ).toBe(
			'{"site":true}'
		);
		expect( readFileSync( join( outputDir, 'resources', '_videos', 'hero.mp4' ), 'utf8' ) ).toBe(
			'video'
		);
	} );

	it( 'derives the local path and manifest key from the originally-requested url when a same-origin response redirects to a variant path', async () => {
		const outputDir = mkdtempSync( join( tmpdir(), 'dla-resource-redirect-' ) );
		dirs.push( outputDir );
		mkdirSync( join( outputDir, 'html' ) );
		mkdirSync( join( outputDir, 'screenshots' ) );
		const sourceUrl = 'https://example.com/';
		const imageUrl = 'https://example.com/img/a.jpg';
		const redirectedUrl = `${ imageUrl };variant`;
		const html = '<html><body><img src="/img/a.jpg"></body></html>';
		writeFileSync( join( outputDir, 'html', 'homepage.html' ), html );
		writeFileSync(
			join( outputDir, 'screenshots', 'manifest.json' ),
			JSON.stringify( { version: 1, entries: { [ sourceUrl ]: { html: 'html/homepage.html' } } } )
		);

		const page = new EventEmitter();
		const store = new CapturedResourceStore( outputDir, sourceUrl );
		store.observe( page as never );

		// A redirected browser fetch fires TWO 'response' events: the redirect
		// hop itself (status 307, url() is the ORIGINAL requested url) and the
		// terminal response (status 200, url() is the REDIRECT TARGET) whose
		// Request is linked back to the original via redirectedFrom().
		const originalRequest = {
			resourceType: () => 'image',
			method: () => 'GET',
			redirectedFrom: () => null,
			url: () => imageUrl,
		};
		const redirectedRequest = {
			resourceType: () => 'image',
			method: () => 'GET',
			redirectedFrom: () => originalRequest,
			url: () => redirectedUrl,
		};
		page.emit( 'response', {
			url: () => imageUrl,
			status: () => 307,
			headers: () => ( { location: redirectedUrl } ),
			body: vi.fn(),
			request: () => originalRequest,
		} );
		page.emit( 'response', {
			url: () => redirectedUrl,
			status: () => 200,
			headers: () => ( { 'content-type': 'image/jpeg' } ),
			body: vi.fn().mockResolvedValue( Buffer.from( 'jpeg bytes' ) ),
			request: () => redirectedRequest,
		} );
		await store.settle( page as never );
		await store.flush();

		const manifest = JSON.parse(
			readFileSync( join( outputDir, 'resources', 'manifest.json' ), 'utf8' )
		);
		// Stored under the ORIGINALLY REQUESTED path, not the redirect target's
		// (which would otherwise double the extension: `a.jpg;variant.jpg`).
		expect( manifest.resources[ imageUrl ] ).toEqual( {
			path: 'resources/img/a.jpg',
			contentType: 'image/jpeg',
		} );
		expect( manifest.resources[ redirectedUrl ] ).toBeUndefined();
		// The redirect hop is a transport detail, not a failed capture.
		expect( manifest.failures ).toEqual( [] );
		expect( readFileSync( join( outputDir, 'resources', 'img', 'a.jpg' ), 'utf8' ) ).toBe(
			'jpeg bytes'
		);

		exportWebsiteCapture( { outputDir, sourceUrl, platform: 'generic', summary: {}, failures: [] } );
		const $ = cheerio.load( readFileSync( join( outputDir, 'website', 'index.html' ), 'utf8' ) );
		const src = $( 'img' ).attr( 'src' )!;
		expect( src ).toBe( '/img/a.jpg' );
		expect( readFileSync( join( outputDir, 'website', src ), 'utf8' ) ).toBe( 'jpeg bytes' );
	} );

	it( 'does not let a same-origin redirect response block the DOM-dependency capture that follows for the same url', async () => {
		const outputDir = mkdtempSync( join( tmpdir(), 'dla-resource-redirect-poster-' ) );
		dirs.push( outputDir );
		mkdirSync( join( outputDir, 'html' ) );
		mkdirSync( join( outputDir, 'screenshots' ) );
		const sourceUrl = 'https://example.com/';
		const posterUrl = 'https://example.com/photos/day12/clip.jpg';
		const redirectedUrl = `${ posterUrl };variant`;
		const html = `<html><body><video poster="${ posterUrl }" preload="none"></video></body></html>`;
		writeFileSync( join( outputDir, 'html', 'homepage.html' ), html );
		writeFileSync(
			join( outputDir, 'screenshots', 'manifest.json' ),
			JSON.stringify( { version: 1, entries: { [ sourceUrl ]: { html: 'html/homepage.html' } } } )
		);
		const page = new EventEmitter();
		const fetchMedia = vi.fn( async ( url: string ) => ( {
			finalUrl: url,
			status: 200,
			headers: new Headers( { 'content-type': 'image/jpeg' } ),
			body: Buffer.from( 'poster bytes' ),
		} ) );
		const store = new CapturedResourceStore( outputDir, sourceUrl, fetchMedia );
		store.observe( page as never );

		// The browser's OWN (native) fetch of the poster attribute hits the
		// redirect first — the ordering a real page load produces before the
		// DOM-dependency scan below ever runs. Before the fix, capturing this
		// redirect hop under the poster's (correctly original) url claimed the
		// dedupe entry the scan below needs, permanently blocking it.
		const originalRequest = {
			resourceType: () => 'image',
			method: () => 'GET',
			redirectedFrom: () => null,
			url: () => posterUrl,
		};
		page.emit( 'response', {
			url: () => posterUrl,
			status: () => 307,
			headers: () => ( { location: redirectedUrl } ),
			body: vi.fn(),
			request: () => originalRequest,
		} );
		await store.settle( page as never );

		await store.captureDomDependencies( html, sourceUrl );
		await store.flush();

		const manifest = JSON.parse(
			readFileSync( join( outputDir, 'resources', 'manifest.json' ), 'utf8' )
		);
		expect( manifest.resources[ posterUrl ] ).toMatchObject( { contentType: 'image/jpeg' } );
		expect( manifest.failures ).toEqual( [] );
		expect( fetchMedia ).toHaveBeenCalledWith( posterUrl, expect.any( Number ), expect.any( Number ) );

		exportWebsiteCapture( { outputDir, sourceUrl, platform: 'generic', summary: {}, failures: [] } );
		const $ = cheerio.load( readFileSync( join( outputDir, 'website', 'index.html' ), 'utf8' ) );
		const poster = $( 'video' ).attr( 'poster' )!;
		// A real localized image, not the transparent-gif stub a genuinely
		// unfetchable poster still degrades to (covered separately below).
		expect( poster ).not.toMatch( /^data:image\/gif;base64,/ );
		expect( poster ).toMatch( /^\// );
		expect( readFileSync( join( outputDir, 'website', poster ), 'utf8' ) ).toBe( 'poster bytes' );
	} );

	it( 'records media fetches that exceed the capture bound', async () => {
		const outputDir = mkdtempSync( join( tmpdir(), 'dla-resources-' ) );
		dirs.push( outputDir );
		const page = new EventEmitter();
		const store = new CapturedResourceStore( outputDir, 'https://example.com/', async () => {
			throw new Error( 'response body exceeds max 10485760 bytes' );
		} );
		store.observe( page as never );
		page.emit( 'response', {
			url: () => 'https://example.com/_videos/oversized',
			status: () => 200,
			request: () => ( { resourceType: () => 'media' } ),
		} );

		await store.settle( page as never );
		await store.flush();

		const manifest = JSON.parse(
			readFileSync( join( outputDir, 'resources', 'manifest.json' ), 'utf8' )
		);
		expect( manifest.resources ).toEqual( {} );
		expect( manifest.failures ).toEqual( [
			{
				url: 'https://example.com/_videos/oversized',
				error: 'response body exceeds max 10485760 bytes',
			},
		] );
	} );

	it( 'records browser response bodies that do not settle', async () => {
		vi.useFakeTimers();
		const outputDir = mkdtempSync( join( tmpdir(), 'dla-resources-' ) );
		dirs.push( outputDir );
		const page = new EventEmitter();
		const store = new CapturedResourceStore( outputDir, 'https://example.com/' );
		store.observe( page as never );
		page.emit( 'response', {
			url: () => 'https://example.com/styles/pending.css',
			status: () => 200,
			headers: () => ( { 'content-type': 'text/css' } ),
			body: vi.fn( () => new Promise< Buffer >( () => {} ) ),
			request: () => ( { resourceType: () => 'stylesheet' } ),
		} );

		const settled = store.settle( page as never );
		await vi.advanceTimersByTimeAsync( 10_000 );
		await settled;
		await store.flush();

		const manifest = JSON.parse(
			readFileSync( join( outputDir, 'resources', 'manifest.json' ), 'utf8' )
		);
		expect( manifest.resources ).toEqual( {} );
		expect( manifest.failures ).toEqual( [
			{
				url: 'https://example.com/styles/pending.css',
				error: 'resource body timed out after 10000ms',
			},
		] );
	} );

	it( 'captures external passive render resources but excludes provider runtime scripts', async () => {
		const outputDir = mkdtempSync( join( tmpdir(), 'dla-resources-' ) );
		dirs.push( outputDir );
		const page = new EventEmitter();
		const store = new CapturedResourceStore( outputDir, 'https://example.com/' );
		store.observe( page as never );
		for ( const [ url, resourceType, contentType, body ] of [
			[ 'https://cdn.example/styles/site.css', 'stylesheet', 'text/css', 'body{color:red}' ],
			[ 'https://cdn.example/fonts/site.woff2', 'font', 'font/woff2', 'font' ],
			[ 'https://cdn.example/runtime.js', 'script', 'text/javascript', 'runtime' ],
		] ) {
			page.emit( 'response', {
				url: () => url,
				status: () => 200,
				headers: () => ( {
					'content-type': contentType,
					'cache-control': 'public, max-age=3600',
				} ),
				body: vi.fn().mockResolvedValue( Buffer.from( body ) ),
				request: () => ( { resourceType: () => resourceType, method: () => 'GET' } ),
			} );
		}
		await store.settle( page as never );
		const scriptReplay = store.getReplayableResponse(
			'https://cdn.example/runtime.js',
			'script'
		);
		expect( scriptReplay?.contentType ).toBe( 'text/javascript' );
		expect( existsSync( scriptReplay!.path ) ).toBe( true );
		await store.flush();
		const manifest = JSON.parse(
			readFileSync( join( outputDir, 'resources', 'manifest.json' ), 'utf8' )
		);
		expect( Object.keys( manifest.resources ) ).toEqual( [
			'https://cdn.example/styles/site.css',
			'https://cdn.example/fonts/site.woff2',
		] );
		expect( existsSync( scriptReplay!.path ) ).toBe( false );
		for ( const resource of Object.values( manifest.resources ) as Array< { path: string } > ) {
			expect( resource.path ).toMatch( /^resources\/external\/[a-f0-9]{16}\// );
		}
	} );

	it( 'keeps query-string variants in distinct deterministic files', async () => {
		const outputDir = mkdtempSync( join( tmpdir(), 'dla-resources-' ) );
		dirs.push( outputDir );
		const page = new EventEmitter();
		const store = new CapturedResourceStore( outputDir, 'https://example.com/' );
		store.observe( page as never );

		for ( const version of [ '1', '2' ] ) {
			page.emit( 'response', {
				url: () => `https://example.com/assets/app.js?v=${ version }`,
				status: () => 200,
				headers: () => ( { 'content-type': 'text/javascript' } ),
				body: vi.fn().mockResolvedValue( Buffer.from( `version ${ version }` ) ),
				request: () => ( { resourceType: () => 'script' } ),
			} );
		}

		await store.settle( page as never );
		await store.flush();

		const manifest = JSON.parse(
			readFileSync( join( outputDir, 'resources', 'manifest.json' ), 'utf8' )
		);
		const paths = Object.values( manifest.resources ).map(
			( resource ) => ( resource as { path: string } ).path
		);
		expect( new Set( paths ).size ).toBe( 2 );
		for ( const resourcePath of paths ) {
			expect( existsSync( join( outputDir, resourcePath ) ) ).toBe( true );
		}
	} );

	it( 'uses the response image format when a CDN transcodes a misleading URL extension', async () => {
		const outputDir = mkdtempSync( join( tmpdir(), 'dla-resources-' ) );
		dirs.push( outputDir );
		const page = new EventEmitter();
		const store = new CapturedResourceStore( outputDir, 'https://example.com/' );
		store.observe( page as never );
		page.emit( 'response', {
			url: () => 'https://cdn.example/icons/feature.png?resize=88%2C87',
			status: () => 200,
			headers: () => ( { 'content-type': 'image/webp' } ),
			body: vi.fn().mockResolvedValue( Buffer.from( 'webp' ) ),
			request: () => ( { resourceType: () => 'image', method: () => 'GET' } ),
		} );
		await store.settle( page as never );
		await store.flush();

		const manifest = JSON.parse(
			readFileSync( join( outputDir, 'resources', 'manifest.json' ), 'utf8' )
		);
		const resource = manifest.resources[ 'https://cdn.example/icons/feature.png?resize=88%2C87' ];
		expect( resource ).toMatchObject( {
			path: expect.stringMatching( /feature-[a-f0-9]{12}\.webp$/ ),
			contentType: 'image/webp',
		} );
		expect( readFileSync( join( outputDir, resource.path ) ) ).toEqual( Buffer.from( 'webp' ) );
	} );

	it( 'fetches lazy DOM dependencies and nested CSS imports missed by responses', async () => {
		const outputDir = mkdtempSync( join( tmpdir(), 'dla-resources-' ) );
		dirs.push( outputDir );
		const transformedImage =
			'https://cdn.example/image.jpg/v1/fill/w_567,h_740,al_b,q_90/image.jpg';
		const bodies: Record< string, [ string, string ] > = {
			'https://cdn.example/site.css': [
				'text/css',
				'@import "nested.css";.hero{background:url("background.jpg")}',
			],
			'https://cdn.example/nested.css': [ 'text/css', '@font-face{src:url("font.woff2")}' ],
			'https://cdn.example/lazy.jpg': [ 'image/jpeg', 'lazy' ],
			'https://cdn.example/lazy-2.jpg': [ 'image/jpeg', 'lazy2' ],
			'https://cdn.example/background.jpg': [ 'image/jpeg', 'background' ],
			'https://cdn.example/font.woff2': [ 'font/woff2', 'font' ],
			[ transformedImage ]: [ 'image/jpeg', 'transformed' ],
		};
		const store = new CapturedResourceStore( outputDir, 'https://example.com/', async ( url ) => {
			const result = bodies[ url ];
			return {
				finalUrl: url,
				status: result ? 200 : 404,
				headers: new Headers( { 'content-type': result?.[ 0 ] ?? 'text/html' } ),
				body: Buffer.from( result?.[ 1 ] ?? '' ),
			};
		} );
		await store.captureDomDependencies(
			`<link rel="stylesheet" href="https://cdn.example/site.css"><img loading="lazy" src="https://cdn.example/lazy.jpg" srcset="https://cdn.example/lazy-2.jpg 1x, ${ transformedImage } 2x">`,
			'https://example.com/'
		);
		await store.flush();
		const manifest = JSON.parse(
			readFileSync( join( outputDir, 'resources', 'manifest.json' ), 'utf8' )
		);
		expect( Object.keys( manifest.resources ) ).toEqual(
			expect.arrayContaining( Object.keys( bodies ) )
		);
	} );

	it( 'captures and localizes linked audio without fetching ordinary page links', async () => {
		const outputDir = mkdtempSync( join( tmpdir(), 'dla-linked-audio-' ) );
		dirs.push( outputDir );
		mkdirSync( join( outputDir, 'html' ) );
		mkdirSync( join( outputDir, 'screenshots' ) );
		const sourceUrl = 'https://example.com/album/';
		const mp3 = 'https://example.com/audio/Track%201.MP3?download=1&quality=high';
		const bodies: Record< string, [ string, string ] > = {
			[ mp3 ]: [ 'audio/mpeg', 'mp3 audio' ],
			'https://example.com/audio/second.ogg': [ 'audio/ogg', 'ogg audio' ],
			'https://cdn.example/third.wav': [ 'audio/wav', 'wav audio' ],
		};
		const html = `<html><body>
			<a id="mp3" href="../audio/Track 1.MP3?download=1&amp;quality=high">First track</a>
			<a id="duplicate" href="${ mp3.replace( /&/g, '&amp;' ) }">First track again</a>
			<a id="ogg" href="/audio/second.ogg">Second track</a>
			<map name="tracks"><area id="wav" href="https://cdn.example/third.wav" alt="Third track"></map>
			<a href="/about">About</a><a href="#tracks">Tracks</a><div id="tracks"></div>
			<a href="mailto:music@example.com">Email</a><a href="javascript:play('track.mp3')">Play</a>
		</body></html>`;
		writeFileSync( join( outputDir, 'html', 'homepage.html' ), html );
		writeFileSync(
			join( outputDir, 'screenshots', 'manifest.json' ),
			JSON.stringify( { version: 1, entries: { [ sourceUrl ]: { html: 'html/homepage.html' } } } )
		);
		const fetchMedia = vi.fn( async ( url: string ) => ( {
			finalUrl: url,
			status: bodies[ url ] ? 200 : 404,
			headers: new Headers( { 'content-type': bodies[ url ]?.[ 0 ] ?? 'text/html' } ),
			body: Buffer.from( bodies[ url ]?.[ 1 ] ?? '' ),
		} ) );
		const store = new CapturedResourceStore( outputDir, sourceUrl, fetchMedia );
		await store.captureDomDependencies( html, sourceUrl );
		await store.captureDomDependencies( html, sourceUrl );
		await store.flush();
		expect( fetchMedia.mock.calls.map( ( [ url ] ) => url ).sort() ).toEqual( Object.keys( bodies ).sort() );

		const receiptPath = exportWebsiteCapture( {
			outputDir, sourceUrl, platform: 'generic', summary: {}, failures: [],
		} );
		const receipt = JSON.parse( readFileSync( receiptPath, 'utf8' ) );
		const $ = cheerio.load( readFileSync( join( outputDir, 'website', 'index.html' ), 'utf8' ) );
		for ( const [ id, source ] of [ [ 'mp3', mp3 ], [ 'ogg', 'https://example.com/audio/second.ogg' ], [ 'wav', 'https://cdn.example/third.wav' ] ] ) {
			const href = $( `#${ id }` ).attr( 'href' )!;
			expect( href ).toMatch( /^\// );
			const path = decodeURIComponent( new URL( href, 'https://portable.test/' ).pathname );
			expect( readFileSync( join( outputDir, 'website', path ), 'utf8' ) ).toBe( bodies[ source ][ 1 ] );
			expect( receipt.assets ).toContainEqual( { sourceUrl: source, path: `website${ path }` } );
		}
		expect( $( '#duplicate' ).attr( 'href' ) ).toBe( $( '#mp3' ).attr( 'href' ) );
		const diagnostics = JSON.parse( readFileSync( join( outputDir, 'diagnostics.json' ), 'utf8' ) );
		expect( diagnostics.unresolvedDependencies ).toEqual( [] );
		expect( diagnostics.unresolvedAnchors ).toEqual( [ {
			sourceUrl, url: 'https://example.com/about', reason: 'target route was not captured',
		} ] );
	} );

	it.each( [ 'HTTP 404', 'response body exceeds max 10485760 bytes' ] )(
		'retains failed linked-audio evidence when capture reports %s',
		async ( error ) => {
			const outputDir = mkdtempSync( join( tmpdir(), 'dla-linked-audio-failure-' ) );
			dirs.push( outputDir );
			mkdirSync( join( outputDir, 'html' ) );
			mkdirSync( join( outputDir, 'screenshots' ) );
			const sourceUrl = 'https://example.com/';
			const audioUrl = 'https://example.com/track.mp3';
			const html = '<html><body><a href="/track.mp3">Listen to the track</a></body></html>';
			writeFileSync( join( outputDir, 'html', 'homepage.html' ), html );
			writeFileSync(
				join( outputDir, 'screenshots', 'manifest.json' ),
				JSON.stringify( { version: 1, entries: { [ sourceUrl ]: { html: 'html/homepage.html' } } } )
			);
			const store = new CapturedResourceStore( outputDir, sourceUrl, async () => {
				throw new Error( error );
			} );
			await store.captureDomDependencies( html, sourceUrl );
			await store.flush();
			const receiptPath = exportWebsiteCapture( {
				outputDir, sourceUrl, platform: 'generic', summary: {}, failures: [],
			} );
			const diagnostics = JSON.parse( readFileSync( join( outputDir, 'diagnostics.json' ), 'utf8' ) );
			expect( diagnostics.resourceFailures ).toEqual( [ { url: audioUrl, error } ] );
			expect( diagnostics.unresolvedDependencies ).toEqual( [ {
				url: audioUrl, sourceUrl, error: 'referenced same-origin dependency was not captured',
			} ] );
			expect( diagnostics.unresolvedAnchors ).toEqual( [] );
			expect( JSON.parse( readFileSync( receiptPath, 'utf8' ) ).assets ).toEqual( [] );
			const evidence = JSON.parse( readFileSync( join( outputDir, 'asset-evidence.json' ), 'utf8' ) );
			expect( evidence.assets ).toMatchObject( [ {
				sourceUrl: audioUrl, outcome: 'failed', retrieval: 'failed', portable: 'not-included', error,
			} ] );
			const $ = cheerio.load( readFileSync( join( outputDir, 'website', 'index.html' ), 'utf8' ) );
			expect( $( 'a' ).attr( 'href' ) ).toBe( audioUrl );
			expect( $( 'a' ).text() ).toBe( 'Listen to the track' );
		}
	);

	it( 'captures and localizes a video src, a child source, and its poster', async () => {
		const outputDir = mkdtempSync( join( tmpdir(), 'dla-video-' ) );
		dirs.push( outputDir );
		mkdirSync( join( outputDir, 'html' ) );
		mkdirSync( join( outputDir, 'screenshots' ) );
		const sourceUrl = 'https://example.com/';
		const mp4 = 'https://example.com/photos/day12/clip.mp4';
		const poster = 'https://example.com/photos/day12/clip.jpg';
		const webm = 'https://example.com/photos/day12/clip.webm';
		const bodies: Record< string, [ string, string ] > = {
			[ mp4 ]: [ 'video/mp4', 'mp4 bytes' ],
			[ poster ]: [ 'image/jpeg', 'poster bytes' ],
			[ webm ]: [ 'video/webm', 'webm bytes' ],
		};
		const html = `<html><body>
			<video id="attr" src="photos/day12/clip.mp4" poster="photos/day12/clip.jpg" playsinline preload="none" width="1280" height="720"></video>
			<video id="child" poster="photos/day12/clip.jpg"><source src="photos/day12/clip.webm" type="video/webm"></video>
		</body></html>`;
		writeFileSync( join( outputDir, 'html', 'homepage.html' ), html );
		writeFileSync(
			join( outputDir, 'screenshots', 'manifest.json' ),
			JSON.stringify( { version: 1, entries: { [ sourceUrl ]: { html: 'html/homepage.html' } } } )
		);
		const fetchMedia = vi.fn( async ( url: string ) => ( {
			finalUrl: url,
			status: bodies[ url ] ? 200 : 404,
			headers: new Headers( { 'content-type': bodies[ url ]?.[ 0 ] ?? 'text/html' } ),
			body: Buffer.from( bodies[ url ]?.[ 1 ] ?? '' ),
		} ) );
		const store = new CapturedResourceStore( outputDir, sourceUrl, fetchMedia );
		await store.captureDomDependencies( html, sourceUrl );
		await store.flush();
		expect( fetchMedia.mock.calls.map( ( [ url ] ) => url ).sort() ).toEqual( Object.keys( bodies ).sort() );

		const receiptPath = exportWebsiteCapture( {
			outputDir, sourceUrl, platform: 'generic', summary: {}, failures: [],
		} );
		const receipt = JSON.parse( readFileSync( receiptPath, 'utf8' ) );
		const $ = cheerio.load( readFileSync( join( outputDir, 'website', 'index.html' ), 'utf8' ) );

		// The bare `<video src poster>` form localizes both attributes.
		const attrSrc = $( '#attr' ).attr( 'src' )!;
		expect( attrSrc ).toMatch( /^\// );
		expect( readFileSync( join( outputDir, 'website', attrSrc ), 'utf8' ) ).toBe( 'mp4 bytes' );
		const attrPoster = $( '#attr' ).attr( 'poster' )!;
		expect( attrPoster ).toMatch( /^\// );
		expect( readFileSync( join( outputDir, 'website', attrPoster ), 'utf8' ) ).toBe( 'poster bytes' );

		// The `<video><source></video>` form localizes the child's src too, and
		// shares the already-localized poster (same source url).
		expect( $( '#child' ).attr( 'poster' ) ).toBe( attrPoster );
		const childSrc = $( '#child source' ).attr( 'src' )!;
		expect( childSrc ).toMatch( /^\// );
		expect( readFileSync( join( outputDir, 'website', childSrc ), 'utf8' ) ).toBe( 'webm bytes' );

		for ( const [ source, path ] of [
			[ mp4, attrSrc ],
			[ poster, attrPoster ],
			[ webm, childSrc ],
		] ) {
			expect( receipt.assets ).toContainEqual( { sourceUrl: source, path: `website${ path }` } );
		}
		const diagnostics = JSON.parse( readFileSync( join( outputDir, 'diagnostics.json' ), 'utf8' ) );
		expect( diagnostics.unresolvedDependencies ).toEqual( [] );
		expect( diagnostics.resourceFailures ).toEqual( [] );
	} );

	it.each( [ 'HTTP 403', 'response body exceeds max 10485760 bytes' ] )(
		'retains a video src and a child source as their resolved url instead of stripping them when capture reports %s',
		async ( error ) => {
			const outputDir = mkdtempSync( join( tmpdir(), 'dla-video-failure-' ) );
			dirs.push( outputDir );
			mkdirSync( join( outputDir, 'html' ) );
			mkdirSync( join( outputDir, 'screenshots' ) );
			const sourceUrl = 'https://example.com/';
			const mp4 = 'https://example.com/clip.mp4';
			const poster = 'https://example.com/clip.jpg';
			const webm = 'https://example.com/clip.webm';
			const html = `<html><body>
				<video id="attr" src="clip.mp4" poster="clip.jpg" preload="none"></video>
				<video id="child"><source src="clip.webm" type="video/webm"></video>
			</body></html>`;
			writeFileSync( join( outputDir, 'html', 'homepage.html' ), html );
			writeFileSync(
				join( outputDir, 'screenshots', 'manifest.json' ),
				JSON.stringify( { version: 1, entries: { [ sourceUrl ]: { html: 'html/homepage.html' } } } )
			);
			const store = new CapturedResourceStore( outputDir, sourceUrl, async () => {
				throw new Error( error );
			} );
			await store.captureDomDependencies( html, sourceUrl );
			await store.flush();
			exportWebsiteCapture( { outputDir, sourceUrl, platform: 'generic', summary: {}, failures: [] } );

			const diagnostics = JSON.parse( readFileSync( join( outputDir, 'diagnostics.json' ), 'utf8' ) );
			expect( diagnostics.resourceFailures ).toEqual( expect.arrayContaining( [
				{ url: mp4, error }, { url: poster, error }, { url: webm, error },
			] ) );
			expect( diagnostics.unresolvedDependencies ).toEqual( expect.arrayContaining( [
				{ url: mp4, sourceUrl, error: 'referenced same-origin dependency was not captured' },
				{ url: webm, sourceUrl, error: 'referenced same-origin dependency was not captured' },
			] ) );

			const $ = cheerio.load( readFileSync( join( outputDir, 'website', 'index.html' ), 'utf8' ) );
			// The video (and its child source) never lose their src — an emptied
			// attribute would make the element unrecoverable downstream (a
			// WordPress import, say, drops it entirely) — so the resolved source
			// url survives as external evidence instead.
			expect( $( '#attr' ).attr( 'src' ) ).toBe( mp4 );
			expect( $( '#child source' ).attr( 'src' ) ).toBe( webm );
			// The poster is an ordinary image: it degrades to the same stub a
			// failed <img> gets, not an external reference.
			expect( $( '#attr' ).attr( 'poster' ) ).toMatch( /^data:image\/gif;base64,/ );
		}
	);

	it( 'keeps script expressions and bare woff2 responses out of capture diagnostics', async () => {
		const outputDir = mkdtempSync( join( tmpdir(), 'dla-resource-diagnostics-' ) );
		dirs.push( outputDir );
		mkdirSync( join( outputDir, 'html' ), { recursive: true } );
		mkdirSync( join( outputDir, 'screenshots' ), { recursive: true } );
		const html =
			'<style>@font-face{src:url("https://cdn.example/site.woff2")}</style>' +
			'<script>function load(route) { return url(" + route + "); }</script>' +
			'<main>Captured page</main>';
		writeFileSync( join( outputDir, 'html', 'homepage.html' ), html );
		writeFileSync(
			join( outputDir, 'screenshots', 'manifest.json' ),
			JSON.stringify( {
				version: 1,
				entries: { 'https://example.com/': { html: 'html/homepage.html' } },
			} )
		);
		const fetchMedia = vi.fn( async ( url: string ) => ( {
			finalUrl: url,
			status: url === 'https://cdn.example/site.woff2' ? 200 : 404,
			// Typekit and other CDNs commonly use the legacy application/* MIME.
			headers: new Headers( { 'content-type': 'application/font-woff2' } ),
			body: Buffer.from( 'font' ),
		} ) );
		const store = new CapturedResourceStore( outputDir, 'https://example.com/', fetchMedia );

		await store.captureDomDependencies( html, 'https://example.com/' );
		await store.flush();
		exportWebsiteCapture( {
			outputDir,
			sourceUrl: 'https://example.com/',
			platform: 'generic',
			summary: {},
			failures: [],
		} );

		const diagnostics = JSON.parse( readFileSync( join( outputDir, 'diagnostics.json' ), 'utf8' ) );
		const resourceManifest = JSON.parse(
			readFileSync( join( outputDir, 'resources', 'manifest.json' ), 'utf8' )
		);
		const fontPath = resourceManifest.resources[ 'https://cdn.example/site.woff2' ].path.replace(
			/^resources\//,
			''
		);
		expect( fetchMedia ).toHaveBeenCalledOnce();
		expect( fetchMedia ).toHaveBeenCalledWith(
			'https://cdn.example/site.woff2',
			expect.any( Number ),
			expect.any( Number )
		);
		expect( diagnostics.resourceFailures ).toEqual( [] );
		expect( diagnostics.unresolvedDependencies ).toEqual( [] );
		expect( resourceManifest.resources[ 'https://cdn.example/site.woff2' ].contentType ).toBe(
			'font/woff2'
		);
		expect( readFileSync( join( outputDir, 'website', fontPath ), 'utf8' ) ).toBe( 'font' );
	} );
	it( 'records a zero-byte font response as a failed dependency', async () => {
		const outputDir = mkdtempSync( join( tmpdir(), 'dla-resource-empty-font-' ) );
		dirs.push( outputDir );
		const fontUrl = 'https://fonts.example/font.woff2';
		const store = new CapturedResourceStore( outputDir, 'https://example.com/', async ( url ) => ( {
			finalUrl: url,
			status: 200,
			headers: new Headers( { 'content-type': 'font/woff2' } ),
			body: Buffer.alloc( 0 ),
		} ) );

		await store.captureDomDependencies(
			`<style>@font-face{src:url("${ fontUrl }")}</style>`,
			'https://example.com/'
		);
		await store.flush();

		const manifest = JSON.parse(
			readFileSync( join( outputDir, 'resources', 'manifest.json' ), 'utf8' )
		);
		// A 200 with no bytes must not be stored as a usable resource: that would
		// report a clean capture for a font that renders as nothing.
		expect( manifest.resources[ fontUrl ] ).toBeUndefined();
		expect( manifest.failures ).toContainEqual(
			expect.objectContaining( { url: fontUrl, error: 'render dependency response body is empty' } )
		);
	} );

	describe( 'video/audio resource limits', () => {
		it( 'captures video far larger than the old flat 10 MB per-resource cap, and shrinks the per-resource ceiling as the aggregate budget is consumed', async () => {
			const outputDir = mkdtempSync( join( tmpdir(), 'dla-video-budget-' ) );
			dirs.push( outputDir );
			mkdirSync( join( outputDir, 'html' ) );
			mkdirSync( join( outputDir, 'screenshots' ) );
			const sourceUrl = 'https://example.com/';
			const videoA = 'https://example.com/media/a.mp4';
			const videoB = 'https://example.com/media/b.mp4';
			const videoC = 'https://example.com/media/c.mp4';
			const html = `<html><body>
				<video id="a" src="/media/a.mp4"></video>
				<video id="b" src="/media/b.mp4"></video>
				<video id="c" src="/media/c.mp4"></video>
			</body></html>`;
			writeFileSync( join( outputDir, 'html', 'homepage.html' ), html );
			writeFileSync(
				join( outputDir, 'screenshots', 'manifest.json' ),
				JSON.stringify( { version: 1, entries: { [ sourceUrl ]: { html: 'html/homepage.html' } } } )
			);

			// A and B are each already bigger than the OLD flat 10 MB cap that used
			// to reject every video. C's DECLARED size (60 MB) fits comfortably
			// under the wide video ceiling (100 MB) on its own — it is only
			// rejected because, by the time it is captured, A and B have already
			// consumed 200 MB of the run's 256 MB aggregate budget, leaving 56 MB.
			const declaredSizes: Record< string, number > = {
				[ videoA ]: MAX_CAPTURED_VIDEO_RESOURCE_BYTES,
				[ videoB ]: MAX_CAPTURED_VIDEO_RESOURCE_BYTES,
				[ videoC ]: 60 * 1024 * 1024,
			};
			// Mirrors safeFetch's own contract (enforced for real in production —
			// see safe-fetch.ts's Content-Length precheck and streamed byte
			// counter): it never returns more bytes than the `maxBytes` it was
			// asked to enforce.
			const fetchMedia = vi.fn( async ( url: string, maxBytes: number ) => {
				const size = declaredSizes[ url ];
				if ( size === undefined ) {
					return { finalUrl: url, status: 404, headers: new Headers(), body: Buffer.alloc( 0 ) };
				}
				if ( size > maxBytes ) {
					throw new Error( `response body exceeds max ${ maxBytes } bytes (streamed)` );
				}
				return {
					finalUrl: url,
					status: 200,
					headers: new Headers( { 'content-type': 'video/mp4' } ),
					body: Buffer.alloc( size ),
				};
			} );
			const store = new CapturedResourceStore( outputDir, sourceUrl, fetchMedia );

			// Sequential, not concurrent — DOM_RESOURCE_CONCURRENCY would otherwise
			// let all three race for budget in the same batch, making which one(s)
			// get rejected nondeterministic.
			await store.captureDomDependencies( `<video src="${ videoA }"></video>`, sourceUrl );
			await store.captureDomDependencies( `<video src="${ videoB }"></video>`, sourceUrl );
			await store.captureDomDependencies( `<video src="${ videoC }"></video>`, sourceUrl );
			await store.flush();

			const maxBytesByUrl = new Map(
				fetchMedia.mock.calls.map( ( [ url, maxBytes ] ) => [ url, maxBytes ] )
			);
			// The run starts with the full 256 MB free, so A and B each get the
			// full 100 MB video ceiling — far above the old flat 10 MB cap.
			expect( maxBytesByUrl.get( videoA ) ).toBe( MAX_CAPTURED_VIDEO_RESOURCE_BYTES );
			expect( maxBytesByUrl.get( videoB ) ).toBe( MAX_CAPTURED_VIDEO_RESOURCE_BYTES );
			// C's ceiling is bounded by what's LEFT of the aggregate budget
			// (256 - 100 - 100 = 56 MB), not the flat 100 MB video ceiling — the
			// per-resource limit cooperates with the aggregate cap instead of
			// racing past it.
			expect( maxBytesByUrl.get( videoC ) ).toBe(
				MAX_CAPTURED_RESOURCE_TOTAL_BYTES - 2 * MAX_CAPTURED_VIDEO_RESOURCE_BYTES
			);

			const manifest = JSON.parse(
				readFileSync( join( outputDir, 'resources', 'manifest.json' ), 'utf8' )
			);
			// A and B — each far bigger than the old flat 10 MB cap — are captured.
			expect( manifest.resources[ videoA ] ).toMatchObject( { contentType: 'video/mp4' } );
			expect( manifest.resources[ videoB ] ).toMatchObject( { contentType: 'video/mp4' } );
			expect( statSync( join( outputDir, manifest.resources[ videoA ].path ) ).size ).toBe(
				MAX_CAPTURED_VIDEO_RESOURCE_BYTES
			);
			// C genuinely exceeds what's left of the run's budget: the aggregate
			// cap still cannot be exceeded, and the rejection is recorded, not
			// silent.
			expect( manifest.resources[ videoC ] ).toBeUndefined();
			expect( manifest.failures ).toContainEqual( expect.objectContaining( { url: videoC } ) );

			// The rejected video degrades the way PR #320 established: its
			// resolved source url survives as external evidence rather than an
			// emptied/broken attribute.
			exportWebsiteCapture( { outputDir, sourceUrl, platform: 'generic', summary: {}, failures: [] } );
			const $ = cheerio.load( readFileSync( join( outputDir, 'website', 'index.html' ), 'utf8' ) );
			expect( $( '#a' ).attr( 'src' ) ).toMatch( /^\// );
			expect( $( '#b' ).attr( 'src' ) ).toMatch( /^\// );
			expect( $( '#c' ).attr( 'src' ) ).toBe( videoC );
		} );

		it( 'rejects a resource beyond the aggregate budget even if a misbehaving fetch ignores its assigned ceiling', async () => {
			// Defense in depth: `resourceByteCeiling` bounds what a resource is
			// ASKED for, but `reserveBytes` is the backstop that still catches an
			// aggregate overrun if a fetch (real or, here, a test double) ever
			// returns more than it was asked for.
			const outputDir = mkdtempSync( join( tmpdir(), 'dla-video-overrun-' ) );
			dirs.push( outputDir );
			const url = 'https://example.com/media/big.mp4';
			const store = new CapturedResourceStore( outputDir, 'https://example.com/', async () => ( {
				finalUrl: url,
				status: 200,
				headers: new Headers( { 'content-type': 'video/mp4' } ),
				body: Buffer.alloc( MAX_CAPTURED_RESOURCE_TOTAL_BYTES + 1024 ),
			} ) );

			await store.captureDomDependencies( `<video src="${ url }"></video>`, 'https://example.com/' );
			await store.flush();

			const manifest = JSON.parse(
				readFileSync( join( outputDir, 'resources', 'manifest.json' ), 'utf8' )
			);
			expect( manifest.resources[ url ] ).toBeUndefined();
			expect( manifest.failures ).toContainEqual( {
				url,
				error: `captured resource bytes exceed aggregate max ${ MAX_CAPTURED_RESOURCE_TOTAL_BYTES }`,
			} );
		} );

		it( 'scales the resource body read timeout with the declared size, and still terminates', async () => {
			vi.useFakeTimers();
			const outputDir = mkdtempSync( join( tmpdir(), 'dla-resources-' ) );
			dirs.push( outputDir );
			const page = new EventEmitter();
			const store = new CapturedResourceStore( outputDir, 'https://example.com/' );
			store.observe( page as never );
			// 30 MB at the assumed 2 MB/s floor throughput scales to a 15s
			// deadline — longer than the flat 10s a small resource keeps (covered
			// by the unrelated "does not settle" case above), shorter than the
			// 90s hard ceiling.
			const declaredBytes = 30 * 1024 * 1024;
			page.emit( 'response', {
				url: () => 'https://example.com/videos/pending.mp4',
				status: () => 200,
				headers: () => ( {
					'content-type': 'video/mp4',
					'content-length': String( declaredBytes ),
				} ),
				body: vi.fn( () => new Promise< Buffer >( () => {} ) ),
				// A JS video player streaming through fetch()/XHR rather than a
				// <video> element — resourceType 'fetch', not 'media' — is exactly
				// the case whose Content-Type (not resourceType) must decide the
				// scaled ceiling.
				request: () => ( { resourceType: () => 'fetch' } ),
			} );

			const settled = store.settle( page as never );
			await vi.advanceTimersByTimeAsync( 15_000 );
			await settled;
			await store.flush();

			const manifest = JSON.parse(
				readFileSync( join( outputDir, 'resources', 'manifest.json' ), 'utf8' )
			);
			expect( manifest.resources ).toEqual( {} );
			expect( manifest.failures ).toEqual( [
				{
					url: 'https://example.com/videos/pending.mp4',
					error: 'resource body timed out after 15000ms',
				},
			] );
		} );
	} );

	describe( 'resourceTimeoutMs', () => {
		it( 'floors small/unknown sizes at the flat default', () => {
			expect( resourceTimeoutMs( Number.NaN ) ).toBe( CAPTURED_RESOURCE_TIMEOUT_MS );
			expect( resourceTimeoutMs( 0 ) ).toBe( CAPTURED_RESOURCE_TIMEOUT_MS );
			// The existing 10 MB image/font/script cap resolves to exactly the
			// previous flat 10s timeout at the assumed 2 MB/s floor throughput —
			// default behaviour for those types is unchanged by this scaling.
			expect( resourceTimeoutMs( 10 * 1024 * 1024 ) ).toBe( CAPTURED_RESOURCE_TIMEOUT_MS );
		} );

		it( 'scales up for a larger expected size', () => {
			expect( resourceTimeoutMs( 30 * 1024 * 1024 ) ).toBe( 15_000 );
			expect( resourceTimeoutMs( MAX_CAPTURED_VIDEO_RESOURCE_BYTES ) ).toBe( 50_000 );
		} );

		it( 'never exceeds the hard ceiling regardless of size', () => {
			expect( resourceTimeoutMs( 10 * 1024 * 1024 * 1024 ) ).toBe(
				CAPTURED_RESOURCE_TIMEOUT_CEILING_MS
			);
		} );
	} );
} );
