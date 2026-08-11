import { describe, expect, it } from 'vitest';
import {
	createManifest,
	getCaptureRelativePath,
	renderContactSheet,
	type CaptureManifestEntry,
} from './manifest.ts';

const capture: CaptureManifestEntry = {
	scenario: 'site-overview',
	theme: 'dark',
	preset: 'smoke',
	captureTier: 'renderer',
	hostProfile: 'browser',
	simulatedHost: true,
	applicationMode: 'browser',
	logicalViewport: { width: 900, height: 600 },
	deviceScaleFactor: 1,
	outputDimensions: { width: 900, height: 600 },
	composition: {
		crop: 'none',
		padding: 'none',
		background: 'application',
		shadow: 'none',
	},
	relativePath: 'site-overview/renderer/dark/smoke.png',
	readyMarker: 'data-marketing-screenshot-ready',
	fileSizeBytes: 42_000,
	diagnostics: {
		consoleErrors: [],
		pageErrors: [],
		failedRequests: [],
		unexpectedExternalRequests: [],
	},
};

describe( 'capture manifest', () => {
	it( 'uses portable output paths', () => {
		expect( getCaptureRelativePath( 'add-site', 'light', 'raw-wide-2x' ) ).toBe(
			'add-site/renderer/light/raw-wide-2x.png'
		);
	} );

	it( 'records a synthetic renderer capture', () => {
		const manifest = createManifest( {
			generatedAt: '2026-08-11T12:00:00.000Z',
			git: { commit: 'abc123', dirty: false },
			distDirectory: 'apps/ui/dist-marketing',
			fixedClock: '2026-08-11T12:00:00.000Z',
			captures: [ capture ],
		} );

		expect( manifest ).toMatchObject( {
			schemaVersion: 1,
			syntheticData: true,
			studio: { commit: 'abc123', dirty: false },
			captures: [ { scenario: 'site-overview', captureTier: 'renderer' } ],
		} );
	} );

	it( 'renders a labeled contact sheet linked to the captures', () => {
		const html = renderContactSheet(
			createManifest( {
				generatedAt: '2026-08-11T12:00:00.000Z',
				git: { commit: '<abc123>', dirty: true },
				distDirectory: 'apps/ui/dist-marketing',
				fixedClock: '2026-08-11T12:00:00.000Z',
				captures: [ capture ],
			} )
		);

		expect( html ).toContain( 'site-overview · dark · smoke' );
		expect( html ).toContain( 'site-overview/renderer/dark/smoke.png' );
		expect( html ).toContain( '900 × 600' );
		expect( html ).toContain( '&lt;abc123&gt; (dirty)' );
		expect( html ).not.toContain( '<abc123>' );
	} );
} );
