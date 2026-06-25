import { shell } from 'electron';
import http from 'http';
import os from 'os';
import nodePath from 'path';
import { sanitizeFolderName } from '@studio/common/lib/sanitize-folder-name';
import { getMainWindow } from 'src/main-window';
import { SiteServer } from 'src/site-server';

const HANDOFF_PORT = 48732;
const MAX_BODY_BYTES = 60 * 1024 * 1024;
const DEFAULT_STATIC_SITE_IMPORTER_PLUGIN_URL =
	'https://github.com/Automattic/static-site-importer/releases/latest/download/static-site-importer.zip';

let server: http.Server | undefined;

type FigmaImportRequest = {
	artifact?: Record< string, unknown >;
	siteName?: string;
};

type StaticSiteImporterSource = {
	type: 'website-artifact';
	path: string;
	artifact: Record< string, unknown >;
	payload: Record< string, unknown >;
};

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

function buildStaticSiteImporterPhp( source: StaticSiteImporterSource, siteName: string ): string {
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

if ( isset( $source['artifact'] ) && is_array( $source['artifact'] ) ) {
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

if ( ! function_exists( 'static_site_importer_ability_import_website_artifact' ) ) {
	throw new RuntimeException( 'Static Site Importer website artifact import ability is unavailable.' );
}

$input['artifact'] = $artifact;
$result = static_site_importer_ability_import_website_artifact( $input );
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

async function handleImportRequest( body: FigmaImportRequest ) {
	const artifact = body.artifact;
	if ( ! artifact || typeof artifact !== 'object' || Array.isArray( artifact ) ) {
		throw new Error( 'Missing artifact object.' );
	}

	const siteName = body.siteName?.trim() || artifactTitle( artifact ) || 'Figma Import';
	const timestamp = Date.now();
	const sourcePath = `figma-import-${ timestamp }.studio-import.json`;
	const source: StaticSiteImporterSource = {
		type: 'website-artifact',
		path: sourcePath,
		artifact,
		payload: { artifact },
	};
	const blueprint = {
		landingPage: '/',
		features: {
			networking: true,
		},
		meta: {
			title: siteName,
			description: `Import ${ siteName } from Figma with Static Site Importer.`,
			suggestedSiteName: siteName,
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
			blueprint,
		},
		{ blueprint }
	);

	if ( ! details.running || ! ( 'url' in details ) || ! details.url ) {
		throw new Error( 'Imported Studio site was created but did not start.' );
	}

	await shell.openExternal( details.url );

	return { siteId: details.id, siteName, sitePath, siteUrl: details.url };
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

			try {
				const body = await readJsonBody( request );
				const result = await handleImportRequest( body );
				sendJson( response, 200, {
					success: true,
					schema: 'wordpress-studio/figma-import-handoff-response/v1',
					...result,
				} );
			} catch ( error ) {
				console.error( 'Figma import handoff failed:', error );
				sendJson( response, 400, {
					success: false,
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
