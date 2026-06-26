import { shell } from 'electron';
import http from 'http';
import os from 'os';
import nodePath from 'path';
import { encodePassword } from '@studio/common/lib/passwords';
import { sanitizeFolderName } from '@studio/common/lib/sanitize-folder-name';
import { getMainWindow } from 'src/main-window';
import { SiteServer } from 'src/site-server';
import type { BlueprintV1Declaration } from '@wp-playground/blueprints';

const HANDOFF_PORT = 48732;
const MAX_BODY_BYTES = 60 * 1024 * 1024;
const ADMIN_USERNAME = 'admin';
const ADMIN_PASSWORD = 'password';
const DEFAULT_STATIC_SITE_IMPORTER_PLUGIN_URL =
	'https://github.com/Automattic/static-site-importer/releases/latest/download/static-site-importer.zip';

let server: http.Server | undefined;

type FigmaImportRequest = {
	artifact?: Record< string, unknown >;
	source?: FigmaScenegraphSource | FigmaPluginSource | WebsiteArtifactSource;
	siteName?: string;
};

type ImportSummary = {
	sourceType: string;
	selectionScope?: string;
	pageId?: string;
	pageName?: string;
	selectedNodeCount?: number;
	assetCount?: number;
	diagnosticCount?: number;
	handoffId?: string;
};

type FigmaScenegraphSource = {
	type: 'figma_scenegraph';
	scenegraph: Record< string, unknown >;
	transform_options?: Record< string, unknown >;
	source_metadata?: Record< string, unknown >;
	[ key: string ]: unknown;
};

type WebsiteArtifactSource = {
	type?: 'website-artifact';
	artifact: Record< string, unknown >;
	[ key: string ]: unknown;
};

type FigmaPluginSource = {
	schema: 'wordpress-studio/figma-source/v1';
	source?: Record< string, unknown >;
	intent?: Record< string, unknown >;
	scenegraph?: {
		currentPage?: Record< string, unknown >;
		selectedNodes?: unknown[];
		[ key: string ]: unknown;
	};
	assets?: unknown[] | Record< string, unknown >;
	transform?: Record< string, unknown >;
	debug?: Record< string, unknown >;
	[ key: string ]: unknown;
};

type StaticSiteImporterSource =
	| {
			type: 'figma_scenegraph';
			path: string;
			payload: FigmaScenegraphSource;
	  }
	| {
			type: 'website-artifact';
			path: string;
			artifact: Record< string, unknown >;
			payload: WebsiteArtifactSource;
	  };

type NormalizedImportSource = StaticSiteImporterSource & {
	path: string;
};

function isRecord( value: unknown ): value is Record< string, unknown > {
	return !! value && typeof value === 'object' && ! Array.isArray( value );
}

function corsHeaders(): Record< string, string > {
	return {
		'Access-Control-Allow-Origin': '*',
		'Access-Control-Allow-Methods': 'POST, OPTIONS',
		'Access-Control-Allow-Headers': 'Content-Type',
		'Access-Control-Max-Age': '86400',
	};
}

function sendJson(
	response: http.ServerResponse,
	statusCode: number,
	body: Record< string, unknown >
) {
	response.writeHead( statusCode, {
		'Content-Type': 'application/json',
		...corsHeaders(),
	} );
	response.end( `${ JSON.stringify( body ) }\n` );
}

function phpString( value: string ): string {
	return JSON.stringify( value );
}

export function buildStaticSiteImporterPhp(
	source: StaticSiteImporterSource,
	siteName: string
): string {
	const sourceBase64 = Buffer.from( JSON.stringify( source.payload ) ).toString( 'base64' );

	return `<?php
if ( ! defined( 'ABSPATH' ) ) {
	require_once getcwd() . '/wp-load.php';
}

require_once ABSPATH . 'wp-admin/includes/plugin.php';
require_once ABSPATH . 'wp-admin/includes/file.php';

$source = json_decode( base64_decode( ${ phpString( sourceBase64 ) } ), true );
if ( ! is_array( $source ) ) {
	throw new RuntimeException( 'Static Site Importer source payload could not be decoded.' );
}

$input = array(
	'name'            => ${ phpString( siteName ) },
	'site_title'      => ${ phpString( siteName ) },
	'activate'        => true,
	'overwrite'       => true,
	'source_metadata' => array(
		'source'      => 'figma-to-wordpress-studio',
		'source_path' => ${ phpString( source.path ) },
	),
);

if ( isset( $source['type'] ) && 'figma_scenegraph' === $source['type'] ) {
	if ( ! class_exists( 'Static_Site_Importer_Figma_Import' ) || ! method_exists( 'Static_Site_Importer_Figma_Import', 'import' ) ) {
		throw new RuntimeException( 'Static Site Importer Figma import adapter is unavailable.' );
	}

	$figma_input = array_merge(
		$source,
		array(
			'name'            => ${ phpString( siteName ) },
			'site_title'      => ${ phpString( siteName ) },
			'activate'        => true,
			'overwrite'       => true,
			'source'          => $source,
			'source_metadata' => array_merge(
				isset( $source['source_metadata'] ) && is_array( $source['source_metadata'] ) ? $source['source_metadata'] : array(),
				array(
					'source'      => 'figma-to-wordpress-studio',
					'source_path' => ${ phpString( source.path ) },
				)
			),
		)
	);

	$result = Static_Site_Importer_Figma_Import::import( $figma_input );
} else if ( isset( $source['artifact'] ) && is_array( $source['artifact'] ) ) {
	$artifact = $source['artifact'];
} else {
	if ( ! function_exists( 'static_site_importer_rest_source_artifact' ) ) {
		throw new RuntimeException( 'Static Site Importer source artifact resolver is unavailable.' );
	}

	$artifact = static_site_importer_rest_source_artifact( $source );
	if ( is_wp_error( $artifact ) ) {
		throw new RuntimeException( 'Static Site Importer source resolution failed: ' . $artifact->get_error_message() );
	}
}

if ( ! isset( $result ) ) {
	if ( ! function_exists( 'static_site_importer_ability_import_website_artifact' ) ) {
		throw new RuntimeException( 'Static Site Importer website artifact import ability is unavailable.' );
	}

	$input['artifact'] = $artifact;
	$result = static_site_importer_ability_import_website_artifact( $input );
}
update_option( 'studio_create_from_import_result', $result, false );

if ( ! is_array( $result ) || empty( $result['success'] ) ) {
	throw new RuntimeException( 'Static Site Importer import failed: ' . wp_json_encode( $result ) );
}

$temporary_plugin = 'static-site-importer/static-site-importer.php';
if ( is_plugin_active( $temporary_plugin ) ) {
	deactivate_plugins( $temporary_plugin, true );
}

if ( file_exists( WP_PLUGIN_DIR . '/' . $temporary_plugin ) ) {
	$delete_result = delete_plugins( array( $temporary_plugin ) );
	if ( is_wp_error( $delete_result ) ) {
		throw new RuntimeException( 'Static Site Importer cleanup failed: ' . $delete_result->get_error_message() );
	}
}
?>`;
}

function artifactTitle( artifact: Record< string, unknown > ): string | undefined {
	const directTitle = artifact.site_title || artifact.title || artifact.name;
	if ( typeof directTitle === 'string' && directTitle.trim() ) {
		return directTitle.trim();
	}

	return undefined;
}

function sourceTitle( source: FigmaScenegraphSource | WebsiteArtifactSource ): string | undefined {
	const directTitle = source.site_title || source.title || source.name;
	if ( typeof directTitle === 'string' && directTitle.trim() ) {
		return directTitle.trim();
	}

	const sourceMetadata = source.source_metadata;
	if ( isRecord( sourceMetadata ) ) {
		const metadataTitle = sourceMetadata.site_title || sourceMetadata.title || sourceMetadata.name;
		if ( typeof metadataTitle === 'string' && metadataTitle.trim() ) {
			return metadataTitle.trim();
		}
	}

	if ( 'artifact' in source && isRecord( source.artifact ) ) {
		return artifactTitle( source.artifact );
	}

	return undefined;
}

function isFigmaPluginSource( source: unknown ): source is FigmaPluginSource {
	return isRecord( source ) && source.schema === 'wordpress-studio/figma-source/v1';
}

function isFigmaScenegraphSource( source: unknown ): source is FigmaScenegraphSource {
	return isRecord( source ) && source.type === 'figma_scenegraph';
}

function normalizedAssets( assets: unknown ): unknown[] | Record< string, unknown > {
	if ( Array.isArray( assets ) || isRecord( assets ) ) {
		return assets;
	}

	return [];
}

function stringArray( value: unknown ): string[] {
	if ( ! Array.isArray( value ) ) {
		return [];
	}

	return value.filter( ( item ): item is string => typeof item === 'string' && !! item.trim() );
}

function pluginSourceMetadata( source: FigmaPluginSource ): Record< string, unknown > {
	const metadata = isRecord( source.source?.metadata ) ? source.source.metadata : {};
	const currentPage = isRecord( metadata.currentPage ) ? metadata.currentPage : {};

	return {
		source: 'figma-to-wordpress-studio',
		file_key: typeof metadata.fileKey === 'string' ? metadata.fileKey : undefined,
		file_name: typeof metadata.fileName === 'string' ? metadata.fileName : undefined,
		page_id: typeof currentPage.id === 'string' ? currentPage.id : undefined,
		page_name: typeof currentPage.name === 'string' ? currentPage.name : undefined,
		exported_at:
			typeof source.source?.exportedAt === 'string' ? source.source.exportedAt : undefined,
	};
}

export function summarizeImportRequest( body: FigmaImportRequest ): ImportSummary {
	if ( isFigmaPluginSource( body.source ) ) {
		const intent = isRecord( body.source.intent ) ? body.source.intent : {};
		const scenegraph = isRecord( body.source.scenegraph ) ? body.source.scenegraph : {};
		const debug = isRecord( body.source.debug ) ? body.source.debug : {};
		const debugSummary = isRecord( debug.summary ) ? debug.summary : {};
		const metadata = isRecord( body.source.source?.metadata ) ? body.source.source.metadata : {};
		const currentPage = isRecord( metadata.currentPage ) ? metadata.currentPage : {};
		const selectedNodes = Array.isArray( scenegraph.selectedNodes ) ? scenegraph.selectedNodes : [];
		const assets = body.source.assets;

		return {
			sourceType: 'figma-source',
			selectionScope: typeof intent.scope === 'string' ? intent.scope : undefined,
			pageId: typeof intent.pageId === 'string' ? intent.pageId : undefined,
			pageName: typeof currentPage.name === 'string' ? currentPage.name : undefined,
			selectedNodeCount: selectedNodes.length,
			assetCount: Array.isArray( assets ) ? assets.length : undefined,
			diagnosticCount:
				typeof debugSummary.diagnosticCount === 'number' ? debugSummary.diagnosticCount : undefined,
			handoffId: typeof debug.handoffId === 'string' ? debug.handoffId : undefined,
		};
	}

	if ( isFigmaScenegraphSource( body.source ) ) {
		return { sourceType: 'figma-scenegraph' };
	}

	return { sourceType: 'website-artifact' };
}

function requestIdFromBody( body: FigmaImportRequest, timestamp: number ): string {
	if ( isFigmaPluginSource( body.source ) && isRecord( body.source.debug ) ) {
		const handoffId = body.source.debug.handoffId;
		if ( typeof handoffId === 'string' && handoffId.trim() ) {
			return handoffId.trim();
		}
	}

	return `figma-import-${ timestamp }`;
}

function pluginTransformOptions( source: FigmaPluginSource ): Record< string, unknown > {
	const intent = isRecord( source.intent ) ? source.intent : {};
	const selectedNodeIds = stringArray( intent.selectedNodeIds );
	const options = isRecord( source.transform?.options ) ? { ...source.transform.options } : {};

	if ( selectedNodeIds.length ) {
		options.frame_ids = selectedNodeIds;
		options.entry_frame_id = selectedNodeIds[ 0 ];
		options.frame_id = selectedNodeIds[ 0 ];
		options.multi_page = selectedNodeIds.length > 1;
	}

	if ( typeof intent.pageId === 'string' ) {
		options.page_id = intent.pageId;
	}

	if ( typeof intent.scope === 'string' ) {
		options.selection_scope = intent.scope;
	}

	return options;
}

function normalizeFigmaPluginSource(
	source: FigmaPluginSource,
	sourcePath: string
): FigmaScenegraphSource {
	const scenegraph = isRecord( source.scenegraph ) ? source.scenegraph : {};
	const metadata = isRecord( source.source?.metadata ) ? source.source.metadata : {};
	const selectedNodes = Array.isArray( scenegraph.selectedNodes )
		? scenegraph.selectedNodes.filter( isRecord )
		: [];
	const currentPage = isRecord( scenegraph.currentPage ) ? scenegraph.currentPage : undefined;
	const nodes = selectedNodes.length ? selectedNodes : currentPage ? [ currentPage ] : [];

	if ( ! nodes.length ) {
		throw new Error( 'Missing Figma scenegraph object.' );
	}

	return {
		type: 'figma_scenegraph',
		name: typeof metadata.fileName === 'string' ? metadata.fileName : 'Figma Import',
		schema: 'static-site-importer/import-figma/v1',
		scenegraph: {
			name: typeof metadata.fileName === 'string' ? metadata.fileName : 'Figma Import',
			nodes,
			assets: normalizedAssets( source.assets ),
			source: source.source,
			intent: source.intent,
		},
		assets: normalizedAssets( source.assets ),
		transform_options: pluginTransformOptions( source ),
		source_metadata: {
			...pluginSourceMetadata( source ),
			source_path: sourcePath,
		},
	};
}

export function normalizeImportSource(
	body: FigmaImportRequest,
	timestamp: number
): NormalizedImportSource {
	const sourcePath = `figma-import-${ timestamp }.studio-import.json`;

	if ( isFigmaScenegraphSource( body.source ) ) {
		if ( ! isRecord( body.source.scenegraph ) ) {
			throw new Error( 'Missing Figma scenegraph object.' );
		}

		return {
			type: 'figma_scenegraph',
			path: sourcePath,
			payload: body.source,
		};
	}

	if ( isFigmaPluginSource( body.source ) ) {
		return {
			type: 'figma_scenegraph',
			path: sourcePath,
			payload: normalizeFigmaPluginSource( body.source, sourcePath ),
		};
	}

	const artifact = body.artifact || body.source?.artifact;
	if ( ! isRecord( artifact ) ) {
		throw new Error( 'Missing Figma scenegraph source or artifact object.' );
	}

	return {
		type: 'website-artifact',
		path: sourcePath,
		artifact,
		payload: { type: 'website-artifact', artifact },
	};
}

async function readJsonBody( request: http.IncomingMessage ): Promise< FigmaImportRequest > {
	const chunks: Buffer[] = [];
	let bytes = 0;

	for await ( const chunk of request ) {
		const buffer = Buffer.isBuffer( chunk ) ? chunk : Buffer.from( chunk );
		bytes += buffer.length;
		if ( bytes > MAX_BODY_BYTES ) {
			throw new Error( 'Import payload is too large.' );
		}
		chunks.push( buffer );
	}

	const parsed = JSON.parse( Buffer.concat( chunks ).toString( 'utf8' ) );
	if ( ! parsed || typeof parsed !== 'object' || Array.isArray( parsed ) ) {
		throw new Error( 'Import payload must be a JSON object.' );
	}

	return parsed as FigmaImportRequest;
}

async function handleImportRequest( body: FigmaImportRequest, requestId: string ) {
	const timestamp = Date.now();
	const source = normalizeImportSource( body, timestamp );
	const importSummary = summarizeImportRequest( body );
	const siteName = body.siteName?.trim() || sourceTitle( source.payload ) || 'Figma Import';
	const blueprint: BlueprintV1Declaration = {
		landingPage: '/',
		features: {
			networking: true,
		},
		meta: {
			title: siteName,
			author: 'WordPress Studio',
			description: `Import ${ siteName } from Figma with Static Site Importer.`,
		},
		steps: [
			{
				step: 'installPlugin',
				pluginData: {
					resource: 'url',
					url: DEFAULT_STATIC_SITE_IMPORTER_PLUGIN_URL,
				},
				options: {
					activate: true,
					targetFolderName: 'static-site-importer',
				},
			},
			{
				step: 'runPHP',
				code: buildStaticSiteImporterPhp( source, siteName ),
			},
		],
	};
	const sitePath = nodePath.join(
		os.homedir(),
		'Studio',
		`${ sanitizeFolderName( siteName ) || 'figma-import' }-${ timestamp }`
	);

	const mainWindow = await getMainWindow();
	if ( mainWindow.isMinimized() ) {
		mainWindow.restore();
	}
	mainWindow.focus();

	const { details } = await SiteServer.create(
		{
			path: sitePath,
			name: siteName,
			adminUsername: ADMIN_USERNAME,
			adminPassword: ADMIN_PASSWORD,
			blueprint,
		},
		{ blueprint }
	);
	details.adminUsername = ADMIN_USERNAME;
	details.adminPassword = encodePassword( ADMIN_PASSWORD );

	if ( ! details.running || ! ( 'url' in details ) || ! details.url ) {
		throw new Error( 'Imported Studio site was created but did not start.' );
	}

	const autoLoginUrl = new URL( '/studio-auto-login', details.url );
	autoLoginUrl.searchParams.set( 'redirect_to', details.url );
	await shell.openExternal( autoLoginUrl.toString() );

	return { requestId, siteId: details.id, siteName, sitePath, siteUrl: details.url, importSummary };
}

export function startFigmaImportHandoffServer(): void {
	if ( server ) {
		return;
	}

	server = http.createServer( ( request, response ) => {
		void ( async () => {
			if ( request.method === 'OPTIONS' ) {
				response.writeHead( 204, corsHeaders() );
				response.end();
				return;
			}

			if ( request.method !== 'POST' || request.url !== '/figma-to-wordpress/import' ) {
				sendJson( response, 404, { success: false, error: 'Not found.' } );
				return;
			}

			let requestId = `figma-import-${ Date.now() }`;

			try {
				const body = await readJsonBody( request );
				requestId = requestIdFromBody( body, Date.now() );
				const result = await handleImportRequest( body, requestId );
				sendJson( response, 200, {
					success: true,
					schema: 'wordpress-studio/figma-import-handoff-response/v1',
					...result,
				} );
			} catch ( error ) {
				console.error( `Figma import handoff failed (${ requestId }):`, error );
				sendJson( response, 400, {
					success: false,
					requestId,
					error: error instanceof Error ? error.message : 'Import handoff failed.',
				} );
			}
		} )();
	} );

	server.listen( HANDOFF_PORT, '127.0.0.1', () => {
		console.log( `Figma import handoff server listening on 127.0.0.1:${ HANDOFF_PORT }` );
	} );
	server.on( 'error', ( error ) => {
		console.error( 'Figma import handoff server failed:', error );
		server = undefined;
	} );
}

export function stopFigmaImportHandoffServer(): void {
	server?.close();
	server = undefined;
}
