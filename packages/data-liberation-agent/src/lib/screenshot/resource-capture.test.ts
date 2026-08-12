import { EventEmitter } from 'node:events';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
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
		const store = new CapturedResourceStore( outputDir, 'https://example.com/' );
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
		} );
		expect( manifest.failures ).toEqual( [
			{ url: 'https://example.com/styles/site.css', error: 'HTTP 404' },
		] );
		expect( readFileSync( join( outputDir, 'resources', '_runtimes', 'site.js' ), 'utf8' ) ).toBe(
			'export const site = true;'
		);
		expect( readFileSync( join( outputDir, 'resources', '_json', 'site.json' ), 'utf8' ) ).toBe(
			'{"site":true}'
		);
	} );
} );
