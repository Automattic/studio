import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
	acceptanceScopeFromCapture,
	findCaptureRoot,
	IMPORT_ACCEPTANCE_SCHEMA,
	isImportAccepted,
	reviewImportedSite,
} from '../import-acceptance';
import type { SiteData } from '../cli-config/core';

const directories: string[] = [];
const siteFixture = ( root: string ): SiteData => ( {
	id: 'fixture',
	name: 'Acceptance',
	path: root,
	port: 8881,
	phpVersion: '8.4',
	running: true,
} );
const temporary = () => {
	const root = fs.mkdtempSync( path.join( os.tmpdir(), 'studio-acceptance-' ) );
	directories.push( root );
	return root;
};
afterEach( () => {
	for ( const root of directories.splice( 0 ) ) fs.rmSync( root, { recursive: true, force: true } );
} );

describe( 'capture-bound import acceptance', () => {
	it( 'requires every declared source route and tablet width, retaining declared dialog requirements', () => {
		const reference = {
			scope: { sourceUrls: [ 'https://example.com/', 'https://example.com/about/' ] },
			entries: [
				{ sourceUrl: 'https://example.com/', route: '/' },
				{ sourceUrl: 'https://example.com/about', route: '/about/' },
			],
		};
		expect( acceptanceScopeFromCapture( reference ) ).toEqual( {
			routes: [ '/', '/about/' ],
			widths: [ 390, 768, 1440 ],
			states: [ 'baseline' ],
		} );
		expect(
			acceptanceScopeFromCapture( reference, {
				pages: [ { states: [ { status: 'captured', dialog: {} } ] } ],
			} ).states
		).toContain( 'dialog-open' );
		expect( () =>
			acceptanceScopeFromCapture( { ...reference, entries: reference.entries.slice( 0, 1 ) } )
		).toThrow( /unobserved source routes/ );
	} );
	it( 'locates the actual capture root from a portable directory, not an unrelated artifact', () => {
		const root = temporary();
		fs.mkdirSync( path.join( root, 'website' ) );
		expect( findCaptureRoot( root ) ).toBeUndefined();
		fs.writeFileSync(
			path.join( root, 'capture-receipt.json' ),
			JSON.stringify( { schema: 'data-liberation/capture-receipt/v1' } )
		);
		expect( findCaptureRoot( path.join( root, 'website' ) ) ).toBe( root );
	} );
	it( 'cannot certify conversion-only or absent evidence and keeps an actionable pending report', async () => {
		const root = temporary();
		const site = siteFixture( root );
		const summary = await reviewImportedSite( site, {
			import_report_summary: { quality_pass: true, fallback_count: 0 },
		} );
		expect( summary.status ).toBe( 'pending' );
		expect( summary.reason ).toBe( 'source_capture_required' );
		expect( fs.existsSync( summary.reportPath ) ).toBe( true );
		expect( isImportAccepted( root ) ).toBe( false );
		const stored = path.join( root, '.studio-acceptance', 'summary.json' );
		fs.writeFileSync( stored, JSON.stringify( { schema: 'unrelated', status: 'accepted' } ) );
		expect( isImportAccepted( root ) ).toBe( false );
		fs.writeFileSync(
			stored,
			JSON.stringify( { schema: IMPORT_ACCEPTANCE_SCHEMA, status: 'accepted' } )
		);
		expect( isImportAccepted( root ) ).toBe( true );
	} );
	it( 'old captures remain unproven and are retained rather than compared with a moving origin', async () => {
		const root = temporary();
		const capture = temporary();
		const summary = await reviewImportedSite( siteFixture( root ), {}, capture );
		expect( summary.status ).toBe( 'pending' );
		expect( summary.reason ).toBe( 'frozen_source_evidence_required' );
		expect( fs.existsSync( capture ) ).toBe( true );
	} );
} );
