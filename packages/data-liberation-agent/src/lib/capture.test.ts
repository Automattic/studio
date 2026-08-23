import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SectionSpec } from './replicate/section-extract.js';
import { SectionSpecsStore } from './replicate/section-specs-store.js';
import { MediaStubStore } from './resume-state/index.js';

vi.mock( './media-fetch/media.js', () => ( {
	downloadMedia: vi.fn( async ( url: string, outputDir: string ) => {
		if ( url.endsWith( 'failed.jpg' ) ) {
			return { localPath: null, error: 'download failed' };
		}
		mkdirSync( outputDir, { recursive: true } );
		const localPath = join( outputDir, `${ url.includes( 'mobile' ) ? 'mobile' : 'desktop' }.jpg` );
		writeFileSync( localPath, url );
		return { localPath, error: null };
	} ),
} ) );

import { downloadCaptureSectionMedia } from './capture.js';

const root = join( process.cwd(), '.tmp-test', 'capture-section-media' );
const sourceUrl = 'https://example.com/';

function section( images: Array< { url: string } > ): SectionSpec {
	return {
		sectionIndex: 0,
		images,
		cells: [],
	} as unknown as SectionSpec;
}

describe( 'downloadCaptureSectionMedia', () => {
	afterEach( () => rmSync( root, { recursive: true, force: true } ) );

	it( 'downloads deduplicated desktop and mobile section media and records failures', async () => {
		SectionSpecsStore.load( root ).set(
			sourceUrl,
			[
				section( [
					{ url: 'https://cdn.example.com/desktop.jpg' },
					{ url: 'https://cdn.example.com/failed.jpg' },
				] ),
			],
			[]
		);
		SectionSpecsStore.loadMobile( root ).set(
			sourceUrl,
			[
				section( [
					{ url: 'https://cdn.example.com/desktop.jpg' },
					{ url: 'https://cdn.example.com/mobile.jpg' },
				] ),
			],
			[],
			{ width: 390, height: 844 }
		);

		expect( await downloadCaptureSectionMedia( root, [ sourceUrl ] ) ).toBe( 2 );
		expect( Object.fromEntries( MediaStubStore.load( root ).list() ) ).toMatchObject( {
			'https://cdn.example.com/desktop.jpg': { status: 'success' },
			'https://cdn.example.com/mobile.jpg': { status: 'success' },
			'https://cdn.example.com/failed.jpg': { status: 'error', error: 'download failed' },
		} );
	} );
} );
