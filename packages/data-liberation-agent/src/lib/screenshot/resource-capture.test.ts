import { EventEmitter } from 'node:events';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CapturedResourceStore } from './resource-capture.js';

const dirs: string[] = [];

afterEach( () => {
	for ( const dir of dirs.splice( 0 ) ) rmSync( dir, { recursive: true, force: true } );
} );

describe( 'CapturedResourceStore', () => {
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
			request: () => ( { resourceType: () => 'script' } ),
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
			request: () => ( { resourceType: () => 'script' } ),
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
		expect( fetchMedia ).toHaveBeenCalledWith( 'https://example.com/_videos/hero' );
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
} );
