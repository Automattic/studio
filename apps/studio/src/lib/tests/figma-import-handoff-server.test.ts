/**
 * @vitest-environment node
 */
import { describe, expect, it, vi } from 'vitest';
import { buildStaticSiteImporterPhp } from 'src/lib/figma-import-handoff-server';

vi.mock( 'electron', () => ( {
	shell: { openExternal: vi.fn() },
} ) );

vi.mock( 'src/main-window', () => ( {
	getMainWindow: vi.fn(),
} ) );

vi.mock( 'src/site-server', () => ( {
	SiteServer: { create: vi.fn() },
} ) );

describe( 'buildStaticSiteImporterPhp', () => {
	it( 'routes Figma scenegraph sources through the SSI Figma importer', () => {
		const php = buildStaticSiteImporterPhp(
			{
				type: 'figma_scenegraph',
				path: 'figma-import-123.studio-import.json',
				payload: {
					type: 'figma_scenegraph',
					scenegraph: { document: { id: '0:1' } },
					transform_options: { frame_id: '1:2' },
					source_metadata: { file_key: 'abc123' },
				},
			},
			'Imported Figma Site'
		);

		expect( php ).toContain( "'figma_scenegraph' === $source['type']" );
		expect( php ).toContain( 'Static_Site_Importer_Figma_Import::import( $figma_input )' );
		expect( php ).toContain( "'source'          => $source" );
		expect( php ).toContain( '\'source_path\' => "figma-import-123.studio-import.json"' );
	} );

	it( 'keeps website artifact imports on the artifact ability path', () => {
		const php = buildStaticSiteImporterPhp(
			{
				type: 'website-artifact',
				path: 'figma-import-123.studio-import.json',
				artifact: { files: [] },
				payload: { type: 'website-artifact', artifact: { files: [] } },
			},
			'Imported Artifact Site'
		);

		expect( php ).toContain( 'static_site_importer_ability_import_website_artifact( $input )' );
		expect( php ).toContain( "$input['artifact'] = $artifact" );
	} );
} );
