import fs from 'fs';
import os from 'os';
import path from 'path';
import { vi } from 'vitest';
import { isSqliteIntegrationAvailable } from 'cli/lib/sqlite-integration';
import { prepareSourceImport } from 'cli/lib/static-site-import/prepare';
import { Logger } from 'cli/logger';

vi.mock( 'cli/lib/sqlite-integration' );

describe( 'prepareSourceImport', () => {
	beforeEach( () => {
		vi.mocked( isSqliteIntegrationAvailable ).mockResolvedValue( true );
	} );

	it( 'resumes a staged URL import without capturing the source again', async () => {
		const siteRoot = fs.mkdtempSync( path.join( os.tmpdir(), 'studio-url-resume-' ) );
		const sitePath = path.join( siteRoot, 'site' );
		const staged = path.join( sitePath, '.studio-import' );
		const request = `${ JSON.stringify( {
			site_title: 'Liberated Site',
			source_metadata: { source: 'studio-create-from', source_path: 'https://example.com' },
		} ) }\n`;
		await fs.promises.mkdir( path.join( staged, 'source' ), { recursive: true } );
		await fs.promises.writeFile( path.join( staged, 'source', 'index.html' ), '<main>Hi</main>' );
		// A staged URL capture carries its receipt next to the page files.
		await fs.promises.writeFile(
			path.join( staged, 'source', 'capture-receipt.json' ),
			JSON.stringify( {
				schema: 'blocks-engine-capture/capture-receipt/v1',
				websiteRoot: 'website',
			} )
		);
		await fs.promises.writeFile( path.join( staged, 'request.json' ), request );
		const liberate = vi.fn();

		try {
			const resumed = await prepareSourceImport(
				'https://example.com',
				sitePath,
				'Liberated Site',
				new Logger(),
				{ staticSiteImporter: 'https://example.com/ssi.zip', liberate }
			);
			expect( liberate ).not.toHaveBeenCalled();
			expect( resumed.blueprint.staticSiteImport.request ).toBe( request );
			const inferred = await prepareSourceImport(
				'https://example.com',
				sitePath,
				undefined,
				new Logger(),
				{ staticSiteImporter: 'https://example.com/ssi.zip', liberate }
			);
			expect( inferred.siteName ).toBe( 'Liberated Site' );

			// A different source at the same path is a new import, not a resume.
			await expect(
				prepareSourceImport( 'https://other.example', sitePath, 'Other', new Logger(), {
					staticSiteImporter: 'https://example.com/ssi.zip',
					liberate: liberate.mockRejectedValue( new Error( 'captured' ) ),
				} )
			).rejects.toThrow( 'captured' );
		} finally {
			await fs.promises.rm( siteRoot, { recursive: true, force: true } );
		}
	} );

	it( 'uses a captured document title for site identity unless --name overrides it', async () => {
		const root = fs.mkdtempSync( path.join( os.tmpdir(), 'studio-captured-title-' ) );
		const website = path.join( root, 'website' );
		await fs.promises.mkdir( website );
		await fs.promises.writeFile(
			path.join( website, 'index.html' ),
			'<title>Example Brand</title><main>Hello</main>'
		);
		await fs.promises.writeFile(
			path.join( root, 'capture-receipt.json' ),
			JSON.stringify( {
				schema: 'blocks-engine-capture/capture-receipt/v1',
				title: '  Example Brand  ',
			} )
		);
		const plugin = 'https://example.com/ssi.zip';
		try {
			const inferred = await prepareSourceImport(
				root,
				path.join( root, 'site' ),
				undefined,
				new Logger(),
				{ staticSiteImporter: plugin }
			);
			const request = JSON.parse( inferred.blueprint.staticSiteImport.request );
			expect( inferred.siteName ).toBe( 'Example Brand' );
			expect( request ).toMatchObject( { name: 'Example Brand', site_title: 'Example Brand' } );
			const explicit = await prepareSourceImport(
				root,
				path.join( root, 'site' ),
				'Custom Name',
				new Logger(),
				{ staticSiteImporter: plugin }
			);
			expect( explicit.siteName ).toBe( 'Custom Name' );
			expect( JSON.parse( explicit.blueprint.staticSiteImport.request ).site_title ).toBe(
				'Custom Name'
			);
			await fs.promises.writeFile( path.join( root, 'capture-receipt.json' ), '{malformed' );
			const fallback = await prepareSourceImport(
				root,
				path.join( root, 'site' ),
				undefined,
				new Logger(),
				{ staticSiteImporter: plugin }
			);
			expect( fallback.siteName ).toBe( 'Imported Site' );
		} finally {
			await fs.promises.rm( root, { recursive: true, force: true } );
		}
	} );
} );
