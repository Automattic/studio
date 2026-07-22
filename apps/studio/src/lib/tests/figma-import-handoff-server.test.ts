/**
 * @vitest-environment node
 */
import { describe, expect, it, vi } from 'vitest';
import {
	buildStaticSiteImporterPhp,
	normalizeImportSource,
	summarizeImportRequest,
} from 'src/lib/figma-import-handoff-server';

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
	it( 'adapts Figma plugin source payloads to the generic SSI scenegraph request', () => {
		const source = normalizeImportSource(
			{
				siteName: 'Plugin Import',
				source: {
					schema: 'wordpress-studio/figma-source/v1',
					source: {
						type: 'figma',
						metadata: {
							fileKey: 'abc123',
							fileName: 'Marketing Site',
							currentPage: { id: '0:1', name: 'Landing' },
						},
						exportedAt: '2026-01-01T00:00:00.000Z',
					},
					intent: {
						scope: 'selected-nodes',
						pageId: '0:1',
						selectedNodeIds: [ '1:2', '1:3' ],
					},
					scenegraph: {
						currentPage: { id: '0:1', type: 'PAGE', name: 'Landing', children: [] },
						selectedNodes: [
							{ id: '1:2', type: 'FRAME', name: 'Home', children: [] },
							{ id: '1:3', type: 'FRAME', name: 'About', children: [] },
						],
					},
					assets: [ { id: 'asset-1', dataUrl: 'data:image/png;base64,YQ==' } ],
					transform: {
						target: 'wordpress',
						route: 'static-site-importer/figma',
						options: { preserveSourceScenegraph: true },
					},
					debug: {
						handoffId: 'handoff-123',
						summary: { diagnosticCount: 2 },
					},
				},
			},
			123
		);

		expect( source.type ).toBe( 'figma_scenegraph' );
		expect( source.payload.scenegraph ).toMatchObject( {
			name: 'Marketing Site',
			nodes: [ { id: '1:2' }, { id: '1:3' } ],
		} );
		expect( source.payload.transform_options ).toMatchObject( {
			frame_ids: [ '1:2', '1:3' ],
			entry_frame_id: '1:2',
			multi_page: true,
			page_id: '0:1',
			selection_scope: 'selected-nodes',
		} );
		expect( source.payload.source_metadata ).toMatchObject( {
			source: 'figma-to-wordpress-studio',
			file_key: 'abc123',
			file_name: 'Marketing Site',
		} );
	} );

	it( 'summarizes Figma plugin handoff diagnostics for responses and logs', () => {
		const summary = summarizeImportRequest( {
			siteName: 'Plugin Import',
			source: {
				schema: 'wordpress-studio/figma-source/v1',
				source: {
					type: 'figma',
					metadata: {
						fileName: 'Marketing Site',
						currentPage: { id: '0:1', name: 'Landing' },
					},
					exportedAt: '2026-01-01T00:00:00.000Z',
				},
				intent: {
					scope: 'document',
					pageId: '0:1',
					selectedNodeIds: [ '1:2' ],
				},
				scenegraph: {
					currentPage: { id: '0:1', type: 'PAGE', name: 'Landing', children: [] },
					selectedNodes: [ { id: '1:2', type: 'FRAME', name: 'Home', children: [] } ],
				},
				assets: [ { id: 'asset-1' } ],
				debug: {
					handoffId: 'handoff-123',
					summary: { diagnosticCount: 2 },
				},
			},
		} );

		expect( summary ).toEqual( {
			sourceType: 'figma-source',
			selectionScope: 'document',
			pageId: '0:1',
			pageName: 'Landing',
			selectedNodeCount: 1,
			assetCount: 1,
			diagnosticCount: 2,
			handoffId: 'handoff-123',
		} );
	} );

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
		expect( php ).not.toContain( 'studio_create_from_import_result' );
	} );

	it( 'stores the import result only when requested', () => {
		const php = buildStaticSiteImporterPhp(
			{
				type: 'website-artifact',
				path: 'figma-import-123.studio-import.json',
				artifact: { files: [] },
				payload: { type: 'website-artifact', artifact: { files: [] } },
			},
			'Imported Artifact Site',
			true
		);

		expect( php ).toContain( 'studio_create_from_import_result' );
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
