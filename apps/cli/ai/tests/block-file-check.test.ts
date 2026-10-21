import { mkdir, mkdtemp, readFile, rm, writeFile } from 'fs/promises';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { validateBlocks } from 'cli/ai/block-validator';
import { checkBlockFile } from 'cli/ai/runtimes/pi/block-file-check';
import { findSiteByFolder } from 'cli/lib/cli-config/sites';

vi.mock( 'cli/ai/block-validator', () => ( { validateBlocks: vi.fn() } ) );
vi.mock( import( 'cli/lib/cli-config/sites' ), async ( importActual ) => ( {
	...( await importActual() ),
	findSiteByFolder: vi.fn(),
} ) );

const original = '<!-- wp:separator --><hr class="wp-block-separator"/><!-- /wp:separator -->';
const fixed =
	'<!-- wp:separator -->\n<hr class="wp-block-separator has-alpha-channel-opacity"/>\n<!-- /wp:separator -->';

describe( 'checkBlockFile', () => {
	let siteDir: string;
	let template: string;

	beforeEach( async () => {
		siteDir = await mkdtemp( path.join( os.tmpdir(), 'studio-block-file-' ) );
		template = path.join( siteDir, 'wp-content', 'themes', 'demo', 'templates', 'index.html' );
		await mkdir( path.dirname( template ), { recursive: true } );
		await writeFile( template, original );
		vi.mocked( findSiteByFolder ).mockImplementation( async ( folder ) =>
			folder === siteDir
				? ( { id: 's', name: 'Demo', path: siteDir, port: 8881 } as never )
				: undefined
		);
	} );

	afterEach( async () => {
		vi.resetAllMocks();
		await rm( siteDir, { recursive: true, force: true } );
	} );

	it( "keeps the block editor's lossless re-serialization of a template in the file", async () => {
		vi.mocked( validateBlocks ).mockResolvedValue( {
			totalBlocks: 1,
			validBlocks: 0,
			invalidBlocks: 1,
			results: [ { blockName: 'core/separator', isValid: false, issues: [], originalContent: '' } ],
			proposedFix: {
				fixedContent: fixed,
				report: { totalBlocks: 1, validBlocks: 1, invalidBlocks: 0, results: [] },
			},
		} );

		const report = await checkBlockFile( template );

		expect( validateBlocks ).toHaveBeenCalledWith( original, 'http://localhost:8881' );
		await expect( readFile( template, 'utf8' ) ).resolves.toBe( fixed );
		expect( report ).toContain( 'wp-content/themes/demo/templates/index.html: the block editor' );
		expect( report ).toContain( 'has-alpha-channel-opacity' );
	} );

	it( 'says when a template is live with blocks the editor rejects', async () => {
		vi.mocked( validateBlocks ).mockResolvedValue( {
			totalBlocks: 1,
			validBlocks: 0,
			invalidBlocks: 1,
			results: [
				{ blockName: 'core/separator', isValid: false, issues: [ 'bad' ], originalContent: '' },
			],
		} );

		const report = await checkBlockFile( template );

		await expect( readFile( template, 'utf8' ) ).resolves.toBe( original );
		expect( report ).toMatch( /rejects 1\/1 blocks[\s\S]*live with these blocks/ );
	} );

	it( 'checks only the theme templates and parts of Studio sites', async () => {
		const styles = path.join( siteDir, 'wp-content', 'themes', 'demo', 'style.css' );
		await writeFile( styles, original );
		const elsewhere = await mkdtemp( path.join( os.tmpdir(), 'not-a-site-' ) );
		const foreign = path.join( elsewhere, 'wp-content', 'themes', 'demo', 'parts', 'header.html' );
		await mkdir( path.dirname( foreign ), { recursive: true } );
		await writeFile( foreign, original );

		try {
			expect( await checkBlockFile( styles ) ).toBeUndefined();
			expect( await checkBlockFile( foreign ) ).toBeUndefined();
			expect( validateBlocks ).not.toHaveBeenCalled();
		} finally {
			await rm( elsewhere, { recursive: true, force: true } );
		}
	} );
} );
