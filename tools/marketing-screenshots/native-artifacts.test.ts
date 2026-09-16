import { describe, expect, it } from 'vitest';
import { renderNativeContactSheet } from './native-artifacts.ts';
import { CAPTURE_PRESETS } from './presets.ts';

describe( 'native capture contact sheet', () => {
	it( 'labels real WordPress and links each full screenshot', () => {
		const html = renderNativeContactSheet( {
			outputDirectory: '/tmp/unused',
			theme: 'dark',
			preset: CAPTURE_PRESETS[ 'raw-wide-2x' ],
			generatedAt: '2026-08-17T12:00:00.000Z',
			captures: [
				{ name: 'annotation-draft', relativePath: 'annotation-draft.png' },
				{ name: 'annotation-submitted', relativePath: 'annotation-submitted.png' },
			],
		} );

		expect( html ).toContain( 'Real isolated WordPress' );
		expect( html ).toContain( 'annotation-draft.png' );
		expect( html ).toContain( 'annotation-submitted.png' );
		expect( html ).toContain( '2880 × 1800' );
	} );
} );
