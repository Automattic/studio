import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { confirm, input, password, select } from '@inquirer/prompts';
import { DEFAULT_WORDPRESS_VERSION, MINIMUM_WORDPRESS_VERSION } from '@studio/common/constants';
import { installAiInstructionsToSite } from '@studio/common/lib/agent-skills';
import { extractFormValuesFromBlueprint } from '@studio/common/lib/blueprint-settings';
import { validateBlueprintData } from '@studio/common/lib/blueprint-validation';
import { SITE_EVENTS } from '@studio/common/lib/cli-events';
import { getDomainNameValidationError } from '@studio/common/lib/domains';
import {
	arePathsEqual,
	isEmptyDir,
	isWordPressDirectory,
	pathExists,
	recursiveCopyDirectory,
} from '@studio/common/lib/fs-utils';
import { getWordPressVersion } from '@studio/common/lib/get-wordpress-version';
import { normalizeLandingPage } from '@studio/common/lib/landing-page';
import { DEFAULT_LOCALE } from '@studio/common/lib/locale';
import { isOnline } from '@studio/common/lib/network-utils';
import {
	createPassword,
	encodePassword,
	validateAdminEmail,
	validateAdminUsername,
} from '@studio/common/lib/passwords';
import { portFinder } from '@studio/common/lib/port-finder';
import { type TracksSiteCreateFlowType } from '@studio/common/lib/record-tracks-event';
import {
	hasDefaultDbBlock,
	removeDbConstants,
} from '@studio/common/lib/remove-default-db-constants';
import { readSharedConfig } from '@studio/common/lib/shared-config';
import {
	isFileAccessAllowedForRuntime,
	SITE_FILE_ACCESS_ALL_FILES,
	SITE_FILE_ACCESS_SITE_DIRECTORY,
	type SiteFileAccess,
} from '@studio/common/lib/site-file-access';
import {
	getSiteRuntime,
	SITE_MODE_NATIVE,
	SITE_MODE_SANDBOX,
	SITE_RUNTIME_NATIVE_PHP,
	siteRuntimeFromMode,
	type SiteRuntime,
} from '@studio/common/lib/site-runtime';
import { sortSites } from '@studio/common/lib/sort-sites';
import { getServerFilesPath } from '@studio/common/lib/well-known-paths';
import {
	isValidWordPressVersion,
	isWordPressVersionAtLeast,
} from '@studio/common/lib/wordpress-version-utils';
import { fetchWordPressVersions } from '@studio/common/lib/wordpress-versions';
import { SiteCommandLoggerAction as LoggerAction } from '@studio/common/logger-actions';
import {
	RecommendedPHPVersion,
	SupportedPHPVersions,
	type SupportedPHPVersion,
} from '@studio/common/types/php-versions';
import { __, sprintf } from '@wordpress/i18n';
import { isStepDefinition, type BlueprintV1Declaration } from '@wp-playground/blueprints';
import { canonicalizeBlocks, cleanupValidatorPages } from 'cli/ai/block-validator';
import { closeSharedBrowser } from 'cli/ai/browser-utils';
import { captureProgressMessage, captureUrl } from 'cli/commands/capture';
import { bumpStat, getPlatformMetric } from 'cli/lib/bump-stat';
import {
	lockCliConfig,
	readCliConfig,
	saveCliConfig,
	SiteData,
	unlockCliConfig,
} from 'cli/lib/cli-config/core';
import { getSiteUrl, removeSiteFromConfig } from 'cli/lib/cli-config/sites';
import { connectToDaemon, disconnectFromDaemon, emitCliEvent } from 'cli/lib/daemon-client';
import {
	getAiInstructionsPath,
	getWordPressVersionPath,
} from 'cli/lib/dependency-management/paths';
import { updateServerFiles } from 'cli/lib/dependency-management/setup';
import { downloadWordPress } from 'cli/lib/dependency-management/wordpress';
import { copyLanguagePackToSite } from 'cli/lib/language-packs';
import { validateSupportedPhpVersion } from 'cli/lib/php-versions';
import { runWpCliCommandWithMessaging } from 'cli/lib/run-wp-cli-command';
import { getPreferredSiteLanguage } from 'cli/lib/site-language';
import { generateSiteName } from 'cli/lib/site-name';
import { getDefaultSitePath } from 'cli/lib/site-paths';
import { logSiteDetails, openSiteInBrowser, setupCustomDomain } from 'cli/lib/site-utils';
import { keepSqliteIntegrationUpdated } from 'cli/lib/sqlite-integration';
import { getTracksOrigin, recordTracksEvent, TRACKS_EVENTS } from 'cli/lib/tracks';
import { StatsGroup } from 'cli/lib/types/bump-stats';
import { untildify } from 'cli/lib/utils';
import { ValidationError } from 'cli/lib/validation-error';
import {
	runBlueprint,
	startWordPressServer,
	stopWordPressServer,
} from 'cli/lib/wordpress-server-manager';
import { Logger, LoggerError } from 'cli/logger';
import { StudioArgv } from 'cli/types';

const logger = new Logger< LoggerAction >();
const DEFAULT_STATIC_SITE_IMPORTER_PLUGIN_URL =
	'https://github.com/Automattic/static-site-importer/releases/download/v1.7.0/static-site-importer.zip';
const STATIC_SITE_IMPORT_CONTRACT = 'ssi-url-import-v4-plan-first';
const STATIC_SITE_IMPORT_IDENTITY_FILE = 'static-site-importer.json';
const STATIC_SITE_IMPORT_RESULT_FILE = 'result.json';
const STATIC_SITE_IMPORT_SOURCE_FILE = 'source.json';
const STATIC_SITE_IMPORT_STATE_FILE = 'state.json';
const STATIC_SITE_IMPORT_CANONICAL_DOCUMENTS_FILE = 'client-canonical-documents.json';
const STATIC_SITE_IMPORT_CANONICAL_UPDATES_FILE = 'client-canonical-updates.json';
const MAX_STATIC_SITE_IMPORT_INVOCATIONS = 10000;
const DATA_LIBERATION_CAPTURE_RECEIPT_SCHEMA = 'data-liberation/capture-receipt/v1';
type StaticSiteImportIdentity = { url: string; contract: string; phase?: 'cleanup_pending' };

type StaticSiteImporterSource =
	| {
			type: 'url';
			path: string;
			payload: Record< string, unknown >;
	  }
	| {
			type: 'website-artifact';
			path: string;
			artifact: Record< string, unknown >;
			payload: Record< string, unknown >;
	  }
	| {
			type: 'source';
			path: string;
			payload: Record< string, unknown >;
	  };

type StaticSiteImporterPlugin = string | { path: string };

export type CreateCommandOptions = {
	name?: string;
	siteId?: string;
	wpVersion: string;
	phpVersion: SupportedPHPVersion;
	runtime: SiteRuntime;
	fileAccess: SiteFileAccess;
	customDomain?: string;
	enableHttps: boolean;
	blueprint?: {
		contents: unknown;
		uri: string;
		staticSiteImport?: {
			code: string;
			source: string;
			storeResult: boolean;
			stagedSource?: {
				sourcePath: string;
				targetName: string;
			};
			identity?: StaticSiteImportIdentity;
			bundlePath?: string;
		};
	};
	adminUsername?: string;
	adminPassword?: string;
	adminEmail?: string;
	noStart: boolean;
	skipBrowser: boolean;
	skipLogDetails: boolean;
	flowType?: TracksSiteCreateFlowType;
};

const SITE_CREATE_FLOW_TYPES: readonly TracksSiteCreateFlowType[] = [
	'new',
	'blueprint',
	'import',
	'sync',
	'duplicate',
];

function parseFlowType( value: string | undefined ): TracksSiteCreateFlowType | undefined {
	return SITE_CREATE_FLOW_TYPES.find( ( flowType ) => flowType === value );
}

function readSiteArtifact( artifactPath: string ): Record< string, unknown > {
	if ( ! fs.existsSync( artifactPath ) ) {
		throw new LoggerError( sprintf( __( 'Artifact file not found: %s' ), artifactPath ) );
	}

	try {
		const artifactContent = fs.readFileSync( artifactPath, 'utf-8' );
		const artifact = JSON.parse( artifactContent );
		if ( ! artifact || typeof artifact !== 'object' || Array.isArray( artifact ) ) {
			throw new Error( __( 'Artifact JSON must be an object.' ) );
		}
		return artifact as Record< string, unknown >;
	} catch ( error ) {
		throw new LoggerError(
			sprintf( __( 'Failed to parse artifact JSON file: %s' ), artifactPath ),
			error
		);
	}
}

function isUrl( value: string ): boolean {
	return value.startsWith( 'http://' ) || value.startsWith( 'https://' );
}

function sourceFilePayload( filePath: string, relativePath: string ): Record< string, string > {
	return {
		path: relativePath.replace( /\\/g, '/' ),
		content_base64: fs.readFileSync( filePath ).toString( 'base64' ),
	};
}

function collectSourceFiles( sourceDir: string ): Record< string, string >[] {
	const files: Record< string, string >[] = [];
	const walk = ( currentDir: string ) => {
		for ( const entry of fs.readdirSync( currentDir, { withFileTypes: true } ) ) {
			if ( entry.name === '.DS_Store' || entry.name === '__MACOSX' ) {
				continue;
			}

			const entryPath = path.join( currentDir, entry.name );
			if ( entry.isDirectory() ) {
				walk( entryPath );
				continue;
			}

			if ( entry.isFile() ) {
				files.push( sourceFilePayload( entryPath, path.relative( sourceDir, entryPath ) ) );
			}
		}
	};
	walk( sourceDir );
	return files;
}

function resolveCaptureWebsiteRoot( sourceDir: string ): string {
	const receiptPath = path.join( sourceDir, 'capture-receipt.json' );
	if ( ! fs.existsSync( receiptPath ) ) {
		return sourceDir;
	}

	const receipt = readSiteArtifact( receiptPath );
	if ( receipt.schema !== DATA_LIBERATION_CAPTURE_RECEIPT_SCHEMA ) {
		return sourceDir;
	}

	if ( typeof receipt.websiteRoot !== 'string' || ! receipt.websiteRoot.trim() ) {
		throw new LoggerError( __( 'Data Liberation capture receipt must declare a website root.' ) );
	}

	const captureRoot = path.resolve( sourceDir );
	const websiteRoot = path.resolve( sourceDir, receipt.websiteRoot );
	const relativeRoot = path.relative( captureRoot, websiteRoot );
	if ( relativeRoot === '..' || relativeRoot.startsWith( `..${ path.sep }` ) ) {
		throw new LoggerError(
			__( 'Data Liberation website root must stay inside the capture directory.' )
		);
	}
	if ( ! fs.existsSync( websiteRoot ) || ! fs.statSync( websiteRoot ).isDirectory() ) {
		throw new LoggerError(
			sprintf( __( 'Data Liberation capture root not found: %s' ), websiteRoot )
		);
	}

	return websiteRoot;
}

function resolveStaticSiteImporterSource(
	sourcePath: string,
	stagedFigmaPath?: string
): StaticSiteImporterSource {
	if ( isUrl( sourcePath ) ) {
		return {
			type: 'url',
			path: sourcePath,
			payload: { url: sourcePath },
		};
	}

	if ( ! fs.existsSync( sourcePath ) ) {
		throw new LoggerError( sprintf( __( 'Import source not found: %s' ), sourcePath ) );
	}

	const stat = fs.statSync( sourcePath );
	if ( stat.isDirectory() ) {
		const artifactPath = path.join( sourcePath, 'artifact.json' );
		if ( fs.existsSync( artifactPath ) ) {
			const artifact = readSiteArtifact( artifactPath );
			if ( artifact.schema === 'blocks-engine/php-transformer/site-artifact/v1' ) {
				return {
					type: 'website-artifact',
					path: artifactPath,
					artifact,
					payload: { artifact },
				};
			}
		}

		const files = collectSourceFiles( resolveCaptureWebsiteRoot( sourcePath ) );
		if ( files.length > 0 ) {
			return {
				type: 'source',
				path: sourcePath,
				payload: { files },
			};
		}

		throw new LoggerError( sprintf( __( 'Import source directory is empty: %s' ), sourcePath ) );
	}

	if ( ! stat.isFile() ) {
		throw new LoggerError(
			sprintf( __( 'Import source must be a file or directory: %s' ), sourcePath )
		);
	}

	const extension = path.extname( sourcePath ).toLowerCase();
	if ( extension === '.json' ) {
		const artifact = readSiteArtifact( sourcePath );
		return {
			type: 'website-artifact',
			path: sourcePath,
			artifact,
			payload: { artifact },
		};
	}

	if ( extension === '.zip' ) {
		return {
			type: 'source',
			path: sourcePath,
			payload: {
				archive: {
					name: path.basename( sourcePath ),
					content_base64: fs.readFileSync( sourcePath ).toString( 'base64' ),
				},
			},
		};
	}

	if ( extension === '.fig' ) {
		if ( ! stagedFigmaPath ) {
			throw new LoggerError( __( 'A staging path is required for Figma imports.' ) );
		}
		return {
			type: 'source',
			path: sourcePath,
			payload: {
				figma_file: {
					name: path.basename( sourcePath ),
					staged_path: stagedFigmaPath,
				},
				transform_options: {
					multi_page: true,
				},
			},
		};
	}

	return {
		type: 'source',
		path: sourcePath,
		payload: {
			files: [ sourceFilePayload( sourcePath, path.basename( sourcePath ) ) ],
		},
	};
}

function buildStaticSiteImporterPhp(
	sourcePath: string,
	siteName: string,
	storeImportResult: boolean,
	adminUsername: string
): string {
	return `<?php
if ( ! function_exists( 'did_action' ) || ! did_action( 'plugins_loaded' ) ) {
	require_once getcwd() . '/wp-load.php';
}

require_once ABSPATH . 'wp-admin/includes/plugin.php';
require_once ABSPATH . 'wp-admin/includes/file.php';

$source_path = ABSPATH . '.studio-import/${ STATIC_SITE_IMPORT_SOURCE_FILE }';
$source_raw = is_file( $source_path ) ? file_get_contents( $source_path ) : false;
$source = is_string( $source_raw ) ? json_decode( $source_raw, true ) : null;
if ( ! is_array( $source ) ) {
	throw new RuntimeException( 'Static Site Importer source payload could not be decoded.' );
}

$admin_user = get_user_by( 'login', ${ phpString( adminUsername ) } );
if ( ! $admin_user instanceof WP_User ) {
	throw new RuntimeException( 'Static Site Importer requires the created local administrator.' );
}
wp_set_current_user( $admin_user->ID, $admin_user->user_login );
if ( ! current_user_can( 'manage_options' ) || ! current_user_can( 'unfiltered_html' ) ) {
	throw new RuntimeException( 'Static Site Importer requires the created local administrator.' );
}

$input = array(
	'name'            => ${ phpString( siteName ) },
	'site_title'      => ${ phpString( siteName ) },
	'activate'        => true,
	'overwrite'       => true,
	'client_script_policy' => 'isolated_preview',
	'client_script_isolated' => true,
	'client_script_provenance' => array( 'ref' => 'studio-create-from:sha256:' . hash( 'sha256', (string) wp_json_encode( $source ) ) ),
	'source_metadata' => array(
		'source'      => 'studio-create-from',
		'source_path' => ${ phpString( sourcePath ) },
	),
);
$url_batch_run = array();
$state_path = ABSPATH . '.studio-import/${ STATIC_SITE_IMPORT_STATE_FILE }';
$state_raw = is_file( $state_path ) ? file_get_contents( $state_path ) : false;
$state = is_string( $state_raw ) ? json_decode( $state_raw, true ) : array();
$state = is_array( $state ) ? $state : array();

function static_site_importer_studio_failure_message( $result, string $fallback ): string {
	if ( ! is_array( $result ) || ! is_array( $result['error'] ?? null ) ) {
		return $fallback;
	}
	$code = is_scalar( $result['error']['code'] ?? null ) ? sanitize_key( (string) $result['error']['code'] ) : '';
	$message = is_scalar( $result['error']['message'] ?? null ) ? sanitize_text_field( (string) $result['error']['message'] ) : '';
	$detail = implode( ': ', array_filter( array( $code, $message ) ) );
	return '' !== $detail ? $fallback . ': ' . substr( $detail, 0, 1000 ) : $fallback;
}

function static_site_importer_studio_bounded_value( $value, int $depth = 0 ) {
	if ( $depth >= 5 ) {
		return null;
	}
	if ( is_bool( $value ) || is_int( $value ) || is_float( $value ) || null === $value ) {
		return $value;
	}
	if ( is_string( $value ) ) {
		return substr( sanitize_text_field( $value ), 0, 1000 );
	}
	if ( ! is_array( $value ) ) {
		return null;
	}
	$projection = array();
	foreach ( array_slice( $value, 0, 50, true ) as $key => $item ) {
		$projected_item = static_site_importer_studio_bounded_value( $item, $depth + 1 );
		if ( null === $projected_item && null !== $item ) {
			continue;
		}
		if ( is_int( $key ) ) {
			$projection[ $key ] = $projected_item;
			continue;
		}
		$projected_key = substr( sanitize_key( (string) $key ), 0, 100 );
		if ( '' !== $projected_key ) {
			$projection[ $projected_key ] = $projected_item;
		}
	}
	return $projection;
}

function static_site_importer_studio_result_projection( $result ): array {
	$projection = array( 'success' => is_array( $result ) && ! empty( $result['success'] ) );
	if ( ! is_array( $result ) ) {
		return $projection;
	}
	if ( is_array( $result['error'] ?? null ) ) {
		$projection['error'] = array(
			'code'    => substr( sanitize_key( (string) ( $result['error']['code'] ?? '' ) ), 0, 200 ),
			'message' => substr( sanitize_text_field( (string) ( $result['error']['message'] ?? '' ) ), 0, 1000 ),
		);
		if ( array_key_exists( 'data', $result['error'] ) ) {
			$projection['error']['data'] = static_site_importer_studio_bounded_value( $result['error']['data'] );
		}
	}
	$import_result = isset( $result['result'] ) && is_array( $result['result'] ) ? $result['result'] : $result;
	$stored_result = array(
		'schema'       => 'studio/static-site-import-result/v1',
		'status'       => substr( sanitize_key( (string) ( $import_result['status'] ?? ( $projection['success'] ? 'completed' : 'failed' ) ) ), 0, 100 ),
		'continuation' => ! empty( $import_result['continuation'] ),
		'pages'        => array_slice( array_map( 'intval', array_values( is_array( $import_result['pages'] ?? null ) ? $import_result['pages'] : array() ) ), 0, 5000 ),
	);
	$request_id = is_array( $import_result['fresh_runtime'] ?? null ) ? (string) ( $import_result['fresh_runtime']['request_id'] ?? '' ) : '';
	if ( '' !== $request_id ) {
		$stored_result['fresh_runtime'] = array( 'request_id' => substr( sanitize_text_field( $request_id ), 0, 200 ) );
	}
	foreach ( array( 'theme', 'theme_slug', 'front_page' ) as $field ) {
		if ( isset( $import_result[ $field ] ) && is_scalar( $import_result[ $field ] ) ) {
			$stored_result[ $field ] = substr( sanitize_text_field( (string) $import_result[ $field ] ), 0, 500 );
		}
	}
	$projection['result'] = $stored_result;
	if ( is_array( $result['diagnostics'] ?? null ) ) {
		$projection['diagnostic_count'] = count( $result['diagnostics'] );
		$projection['diagnostics'] = static_site_importer_studio_bounded_value( $result['diagnostics'] );
	}
	return $projection;
}

function static_site_importer_studio_write_result( array $result ): void {
	$encoded = wp_json_encode( $result );
	if ( ! is_string( $encoded ) ) {
		throw new RuntimeException( 'Static Site Importer result receipt could not be encoded.' );
	}
	$result_path = ABSPATH . '.studio-import/${ STATIC_SITE_IMPORT_RESULT_FILE }';
	$temp_path = $result_path . '.tmp-' . wp_generate_uuid4();
	if ( false === file_put_contents( $temp_path, $encoded ) ) {
		throw new RuntimeException( 'Static Site Importer result receipt could not be saved.' );
	}
	if ( ! rename( $temp_path, $result_path ) ) {
		unlink( $temp_path );
		throw new RuntimeException( 'Static Site Importer result receipt could not be finalized.' );
	}
}

function static_site_importer_studio_record_failure( $result, string $fallback, bool $store_import_result ): void {
	$projection = static_site_importer_studio_result_projection( $result );
	if ( $store_import_result ) {
		update_option( 'studio_create_from_import_result', $projection, false );
	}
	static_site_importer_studio_write_result(
		array(
			'continuation' => false,
			'failed'       => true,
			'failure'      => $projection,
		)
	);
	throw new RuntimeException( static_site_importer_studio_failure_message( $result, $fallback ) );
}

function static_site_importer_studio_reject_catastrophic_content_loss( array $source, array $documents ): void { $st = $si = $it = $ii = 0; foreach ( $source['artifact']['files'] ?? array() as $f ) { if ( is_array( $f ) && str_ends_with( (string) ( $f['path'] ?? '' ), '.html' ) && isset( $f['content'] ) ) { $c = (string) $f['content']; $st += strlen( trim( wp_strip_all_tags( $c, true ) ) ); $si += preg_match_all( '/<img\\b/i', $c ); } } foreach ( $documents as $d ) { $c = (string) ( $d['content'] ?? '' ); $it += strlen( trim( wp_strip_all_tags( $c, true ) ) ); $ii += preg_match_all( '/<!--\\s+wp:image\\b|<img\\b/i', $c ); } if ( $st >= 160 && $si && $documents && $it <= 80 && ! $ii ) throw new RuntimeException( 'Static Site Importer rejected catastrophic content loss: source became navigation-only with no images. Inspect diagnostics.' ); }

$store_import_result = ${ storeImportResult ? 'true' : 'false' };

if ( isset( $source['url'] ) && function_exists( 'static_site_importer_ability_import' ) ) {
	$slug = sanitize_title( ${ phpString( siteName ) } );
	if ( '' === $slug ) {
		$slug = 'imported-site';
	}
	$input['operation'] = 'plan';
	$input['require_proven_dynamic_client_assets'] = false;
	$input['slug'] = $slug;
	$input['source'] = array(
		'type' => 'url',
		'url'  => $source['url'],
	);
	if ( ! empty( $state['import_id'] ) ) {
		$input['source']['import_id'] = (string) $state['import_id'];
	}
	$result = static_site_importer_ability_import( $input );
	if ( ! is_array( $result ) || empty( $result['success'] ) ) {
		static_site_importer_studio_record_failure( $result, 'Static Site Importer planning failed', $store_import_result );
	}
	$url_batch_run = isset( $result['url_batch_run'] ) && is_array( $result['url_batch_run'] ) ? $result['url_batch_run'] : array();
	if ( ! empty( $result['continuation'] ) ) {
		$state = array( 'import_id' => (string) ( $result['import_id'] ?? '' ) );
		if ( '' === $state['import_id'] || false === file_put_contents( $state_path, wp_json_encode( $state ) ) ) {
			throw new RuntimeException( 'Static Site Importer continuation state could not be saved.' );
		}
		$studio_result = array(
			'continuation'     => true,
			'completed_routes' => (int) ( $url_batch_run['completed_routes'] ?? 0 ),
			'total_routes'     => (int) ( $url_batch_run['total_routes'] ?? 0 ),
		);
		file_put_contents( ABSPATH . '.studio-import/${ STATIC_SITE_IMPORT_RESULT_FILE }', wp_json_encode( $studio_result ) );
		return;
	}
	if ( ! isset( $result['plan'] ) || ! is_array( $result['plan'] ) ) {
		throw new RuntimeException( 'Static Site Importer planning completed without a canonical plan.' );
	}
	$state = array( 'import_id' => (string) ( $result['import_id'] ?? '' ) );
	if ( '' !== $state['import_id'] && false === file_put_contents( $state_path, wp_json_encode( $state ) ) ) {
		throw new RuntimeException( 'Static Site Importer terminal state could not be saved.' );
	}
	$apply_input = $input;
	$apply_input['operation'] = 'apply';
	$apply_input['plan'] = $result['plan'];
	unset( $apply_input['source'] );
	$result = static_site_importer_ability_import( $apply_input );
} elseif ( isset( $source['url'] ) && function_exists( 'static_site_importer_ability_import_url' ) ) {
	$input['url'] = $source['url'];
	$input['work_dir'] = ABSPATH . '.studio-import/static-site-importer';
	$input['provider_args'] = array(
		'collect_site'                => true,
		'require_complete_collection' => true,
		'batch_pages'                 => 25,
		'max_effective_batches_per_invocation' => 1,
		'max_invocation_seconds'      => 180,
		'max_bytes'                  => 10485760,
	);
	$input['require_proven_dynamic_client_assets'] = false;
	$result = static_site_importer_ability_import_url( $input );
} elseif ( isset( $source['figma_file'] ) ) {
	if ( ! function_exists( 'static_site_importer_ability_import_figma' ) ) {
		throw new RuntimeException( 'Static Site Importer Figma import ability is unavailable.' );
	}
	$input['source'] = $source;
	$input['transform_options'] = isset( $source['transform_options'] ) && is_array( $source['transform_options'] ) ? $source['transform_options'] : array();
	if ( ! empty( $state['runtime_lifecycle_request_id'] ) ) {
		$input['runtime_lifecycle_phase'] = 'resume';
		$input['runtime_lifecycle_request_id'] = (string) $state['runtime_lifecycle_request_id'];
		if ( ! empty( $state['runtime_lifecycle_checkpoint'] ) ) {
			$input['runtime_lifecycle_checkpoint'] = (string) $state['runtime_lifecycle_checkpoint'];
		}
	} else {
		$input['runtime_lifecycle_phase'] = 'prepare';
	}
	$result = static_site_importer_ability_import_figma( $input );
} else {
	if ( ! function_exists( 'static_site_importer_ability_import' ) ) {
		throw new RuntimeException( 'Static Site Importer canonical import ability is unavailable.' );
	}

	if ( isset( $source['artifact'] ) && is_array( $source['artifact'] ) ) {
		$artifact = $source['artifact'];
		$input['fail_on_quality'] = true;
		$input['require_proven_dynamic_client_assets'] = false;
		$input['seed_entities'] = true;
		$input['materialize_dependencies'] = true;
		if ( in_array( $artifact['theme_materialization'] ?? '', array( 'block', 'classic' ), true ) ) {
			$input['theme_materialization'] = (string) $artifact['theme_materialization'];
		}
		$metadata = $artifact;
		unset( $metadata['schema'], $metadata['entrypoint'], $metadata['files'] );
		$input['source_metadata']['semantic_evidence'] = is_array( $artifact['semantic_evidence'] ?? null ) ? $artifact['semantic_evidence'] : array();
		$input['source'] = array(
			'type'       => 'files',
			'entrypoint' => (string) ( $artifact['entrypoint'] ?? '' ),
			'files'      => isset( $artifact['files'] ) && is_array( $artifact['files'] ) ? $artifact['files'] : array(),
			'metadata'   => $metadata,
		);
	} elseif ( isset( $source['archive'] ) && is_array( $source['archive'] ) ) {
		$input['source'] = array(
			'type' => 'zip',
			'zip'  => $source['archive'],
		);
	} else {
		$input['source'] = array(
			'type'  => 'files',
			'files' => isset( $source['files'] ) && is_array( $source['files'] ) ? $source['files'] : array(),
		);
	}
	if ( ! empty( $state['runtime_lifecycle_request_id'] ) ) {
		$input['runtime_lifecycle_phase'] = 'resume';
		$input['runtime_lifecycle_request_id'] = (string) $state['runtime_lifecycle_request_id'];
		if ( ! empty( $state['runtime_lifecycle_checkpoint'] ) ) {
			$input['runtime_lifecycle_checkpoint'] = (string) $state['runtime_lifecycle_checkpoint'];
		}
	} else {
		$input['runtime_lifecycle_phase'] = 'prepare';
	}

	$result = static_site_importer_ability_import( $input );
}

if ( ! is_array( $result ) || empty( $result['success'] ) ) {
	static_site_importer_studio_record_failure( $result, 'Static Site Importer import failed', $store_import_result );
}
if ( $store_import_result ) {
	update_option( 'studio_create_from_import_result', static_site_importer_studio_result_projection( $result ), false );
}
$import_result = isset( $result['result'] ) && is_array( $result['result'] ) ? $result['result'] : $result;
if ( 'dependencies_prepared' === ( $import_result['status'] ?? '' ) ) {
	$request_id = (string) ( $import_result['fresh_runtime']['request_id'] ?? '' );
	$checkpoint = (string) ( $import_result['fresh_runtime']['lifecycle_checkpoint_id'] ?? $import_result['runtime_lifecycle_checkpoint'] ?? '' );
	$lifecycle_state = array( 'runtime_lifecycle_request_id' => $request_id );
	if ( '' !== $checkpoint ) {
		$lifecycle_state['runtime_lifecycle_checkpoint'] = $checkpoint;
	}
	if ( '' === $request_id || false === file_put_contents( $state_path, wp_json_encode( $lifecycle_state ) ) ) {
		throw new RuntimeException( 'Static Site Importer lifecycle state could not be saved.' );
	}
	static_site_importer_studio_write_result( array( 'continuation' => true ) );
	return;
}
if ( '' !== $state_path && is_file( $state_path ) ) {
	unlink( $state_path );
}
$canonical_documents = array();
foreach ( array_unique( array_map( 'intval', array_values( isset( $import_result['pages'] ) && is_array( $import_result['pages'] ) ? $import_result['pages'] : array() ) ) ) as $post_id ) {
	$post = get_post( $post_id );
	if ( $post instanceof WP_Post ) {
		$canonical_documents[] = array(
			'post_id' => $post_id,
			'content' => (string) $post->post_content,
			'sha256'  => hash( 'sha256', (string) $post->post_content ),
		);
	}
}
if ( ! empty( $canonical_documents ) && false === file_put_contents( ABSPATH . '.studio-import/${ STATIC_SITE_IMPORT_CANONICAL_DOCUMENTS_FILE }', wp_json_encode( $canonical_documents ) ) ) {
	throw new RuntimeException( 'Static Site Importer client canonicalization handoff could not be saved.' );
}
static_site_importer_studio_reject_catastrophic_content_loss( $source, $canonical_documents );

$studio_result = array(
	'continuation'             => ! empty( $import_result['continuation'] ),
	'canonicalization_pending' => ! empty( $canonical_documents ),
	'status'           => (string) ( $import_result['url_batch_run']['status'] ?? 'completed' ),
	'completed_routes' => (int) ( $import_result['url_batch_run']['completed_routes'] ?? 0 ),
	'total_routes'     => (int) ( $import_result['url_batch_run']['total_routes'] ?? 0 ),
);
static_site_importer_studio_write_result( $studio_result );
?>`;
}

function artifactTitle( artifact: Record< string, unknown > ): string | undefined {
	const directTitle = artifact.site_title || artifact.title || artifact.name;
	if ( typeof directTitle === 'string' && directTitle.trim() ) {
		return directTitle.trim();
	}

	const provenance = artifact.provenance;
	if ( provenance && typeof provenance === 'object' && ! Array.isArray( provenance ) ) {
		const provenanceTitle = ( provenance as Record< string, unknown > ).title;
		if ( typeof provenanceTitle === 'string' && provenanceTitle.trim() ) {
			return provenanceTitle.trim();
		}
	}

	return undefined;
}

function phpString( value: string ): string {
	return JSON.stringify( value );
}

export function buildCreateFromSourceBlueprint(
	sourcePath: string,
	siteName: string,
	staticSiteImporterPlugin: StaticSiteImporterPlugin = DEFAULT_STATIC_SITE_IMPORTER_PLUGIN_URL,
	storeImportResult = false,
	adminUsername = 'admin',
	sourceUrl?: string
): {
	contents: BlueprintV1Declaration;
	uri: string;
	staticSiteImport: {
		code: string;
		source: string;
		storeResult: boolean;
		stagedSource?: { sourcePath: string; targetName: string };
		identity?: StaticSiteImportIdentity;
		bundlePath?: string;
	};
} {
	const stagedFigmaName =
		path.extname( sourcePath ).toLowerCase() === '.fig' ? 'source.fig' : undefined;
	const source = resolveStaticSiteImporterSource(
		sourcePath,
		stagedFigmaName ? path.join( '.studio-import', stagedFigmaName ) : undefined
	);
	const tempDir = fs.mkdtempSync( path.join( os.tmpdir(), 'studio-create-from-' ) );
	const blueprintPath = path.join( tempDir, 'blueprint.json' );
	const pluginData =
		typeof staticSiteImporterPlugin === 'string'
			? { resource: 'url' as const, url: staticSiteImporterPlugin }
			: { resource: 'bundled' as const, path: 'static-site-importer.zip' };
	const blueprint: BlueprintV1Declaration = {
		landingPage: '/',
		features: {
			networking: true,
		},
		steps: [
			{
				step: 'installPlugin',
				pluginData,
				options: {
					activate: true,
					targetFolderName: 'static-site-importer',
				},
			},
		],
	};

	try {
		if ( typeof staticSiteImporterPlugin !== 'string' ) {
			fs.copyFileSync(
				staticSiteImporterPlugin.path,
				path.join( tempDir, 'static-site-importer.zip' )
			);
		}
		fs.writeFileSync( blueprintPath, `${ JSON.stringify( blueprint, null, 2 ) }\n` );
	} catch ( error ) {
		fs.rmSync( tempDir, { recursive: true, force: true } );
		throw error;
	}
	return {
		contents: blueprint,
		uri: blueprintPath,
		staticSiteImport: {
			code: buildStaticSiteImporterPhp( source.path, siteName, storeImportResult, adminUsername ),
			source: JSON.stringify( source.payload ),
			storeResult: storeImportResult,
			...( stagedFigmaName ? { stagedSource: { sourcePath, targetName: stagedFigmaName } } : {} ),
			...( source.type === 'url' || sourceUrl
				? { identity: { url: sourceUrl ?? source.path, contract: STATIC_SITE_IMPORT_CONTRACT } }
				: {} ),
			bundlePath: tempDir,
		},
	};
}

function staticSiteImportIdentityPath( sitePath: string ): string {
	return path.join( sitePath, '.studio-import', STATIC_SITE_IMPORT_IDENTITY_FILE );
}

function cleanupSuccessfulStaticSiteImport( sitePath: string, preserveResult = false ): void {
	fs.rmSync( path.join( sitePath, '.studio-import', 'import.php' ), { force: true } );
	if ( ! preserveResult ) {
		fs.rmSync( path.join( sitePath, '.studio-import', STATIC_SITE_IMPORT_RESULT_FILE ), {
			force: true,
		} );
	}
	fs.rmSync( path.join( sitePath, '.studio-import', STATIC_SITE_IMPORT_SOURCE_FILE ), {
		force: true,
	} );
	fs.rmSync( path.join( sitePath, '.studio-import', 'source.fig' ), { force: true } );
	fs.rmSync( staticSiteImportIdentityPath( sitePath ), { force: true } );
	fs.rmSync( path.join( sitePath, '.studio-import', STATIC_SITE_IMPORT_STATE_FILE ), {
		force: true,
	} );
	fs.rmSync( path.join( sitePath, '.studio-import', STATIC_SITE_IMPORT_CANONICAL_DOCUMENTS_FILE ), {
		force: true,
	} );
	fs.rmSync( path.join( sitePath, '.studio-import', STATIC_SITE_IMPORT_CANONICAL_UPDATES_FILE ), {
		force: true,
	} );
}

async function canonicalizeStaticSiteImport( site: SiteData, stagingDir: string ): Promise< void > {
	const documentsPath = path.join( stagingDir, STATIC_SITE_IMPORT_CANONICAL_DOCUMENTS_FILE );
	if ( ! fs.existsSync( documentsPath ) ) {
		throw new Error( 'Static site import completed without its canonicalization handoff.' );
	}

	const documents = JSON.parse( fs.readFileSync( documentsPath, 'utf-8' ) ) as Array< {
		post_id: number;
		content: string;
		sha256: string;
	} >;
	if ( ! Array.isArray( documents ) || documents.length === 0 ) {
		throw new Error( 'Static site import returned an invalid canonicalization handoff.' );
	}

	const updates = [];
	const siteUrl = getSiteUrl( site );
	for ( const document of documents ) {
		if (
			! Number.isInteger( document.post_id ) ||
			document.post_id <= 0 ||
			typeof document.content !== 'string' ||
			document.sha256 !== crypto.createHash( 'sha256' ).update( document.content ).digest( 'hex' )
		) {
			throw new Error( 'Static site import returned a corrupt canonicalization document.' );
		}
		const content = await canonicalizeBlocks( document.content, siteUrl );
		if ( content !== document.content ) {
			updates.push( {
				post_id: document.post_id,
				before_sha256: document.sha256,
				after_sha256: crypto.createHash( 'sha256' ).update( content ).digest( 'hex' ),
				content,
			} );
		}
	}

	if ( updates.length > 0 ) {
		const updatesPath = path.join( stagingDir, STATIC_SITE_IMPORT_CANONICAL_UPDATES_FILE );
		fs.writeFileSync( updatesPath, JSON.stringify( updates ) );
		await using command = await runWpCliCommandWithMessaging( site, [
			'eval',
			`$path = ABSPATH . '.studio-import/${ STATIC_SITE_IMPORT_CANONICAL_UPDATES_FILE }';
$documents = json_decode( (string) file_get_contents( $path ), true );
if ( ! is_array( $documents ) ) {
	throw new RuntimeException( 'Client canonicalization updates are invalid.' );
}
foreach ( $documents as $document ) {
	$post = get_post( (int) ( $document['post_id'] ?? 0 ) );
	if ( ! $post instanceof WP_Post || ! hash_equals( (string) ( $document['before_sha256'] ?? '' ), hash( 'sha256', (string) $post->post_content ) ) ) {
		throw new RuntimeException( 'Client canonicalization preimage changed before persistence.' );
	}
	$result = wp_update_post( array( 'ID' => $post->ID, 'post_content' => wp_slash( (string) ( $document['content'] ?? '' ) ) ), true );
	$updated = get_post( $post->ID );
	if ( is_wp_error( $result ) || ! $updated instanceof WP_Post || ! hash_equals( (string) ( $document['after_sha256'] ?? '' ), hash( 'sha256', (string) $updated->post_content ) ) ) {
		throw new RuntimeException( 'Client canonicalization did not persist exact target-registry bytes.' );
	}
}`,
		] );
		const [ exitCode, stdout, stderr ] = await Promise.all( [
			command.response.exitCode,
			command.response.stdoutText,
			command.response.stderrText,
		] );
		if ( exitCode !== 0 ) {
			throw new Error(
				stderr.trim() || stdout.trim() || sprintf( __( 'WP-CLI exited with code %d.' ), exitCode )
			);
		}
		fs.rmSync( updatesPath, { force: true } );
	}

	fs.rmSync( documentsPath, { force: true } );
}

async function runStaticSiteImport(
	site: SiteData,
	code: string,
	source: string,
	stagedSource?: { sourcePath: string; targetName: string },
	identity?: StaticSiteImportIdentity,
	preserveResult = false
): Promise< boolean > {
	const stagingDir = path.join( site.path, '.studio-import' );
	const scriptName = 'import.php';
	const scriptPath = path.join( stagingDir, scriptName );
	const resultPath = path.join( stagingDir, STATIC_SITE_IMPORT_RESULT_FILE );
	fs.mkdirSync( stagingDir, { recursive: true } );
	if ( stagedSource ) {
		fs.copyFileSync( stagedSource.sourcePath, path.join( stagingDir, stagedSource.targetName ) );
	}
	fs.writeFileSync( path.join( stagingDir, STATIC_SITE_IMPORT_SOURCE_FILE ), source );
	if ( identity ) {
		fs.writeFileSync( staticSiteImportIdentityPath( site.path ), JSON.stringify( identity ) );
	}
	fs.writeFileSync( scriptPath, code );

	const liveOutput = getSiteRuntime( site ) === SITE_RUNTIME_NATIVE_PHP;
	for ( let invocation = 1; invocation <= MAX_STATIC_SITE_IMPORT_INVOCATIONS; invocation++ ) {
		fs.rmSync( resultPath, { force: true } );
		logger.reportStart( LoggerAction.IMPORT_SITE, __( 'Importing static site…' ) );
		await using command = await runWpCliCommandWithMessaging(
			site,
			[ 'eval-file', `${ path.basename( stagingDir ) }/${ scriptName }` ],
			liveOutput ? { liveOutput, onLiveOutput: () => logger.spinner.stop() } : {}
		);
		const startedAt = Date.now();
		const progressTimer = setInterval( () => {
			const elapsedMinutes = Math.max( 1, Math.floor( ( Date.now() - startedAt ) / 60_000 ) );
			logger.reportProgress(
				sprintf(
					__( 'Importing static site… invocation %1$d, %2$d min elapsed' ),
					invocation,
					elapsedMinutes
				)
			);
		}, 60_000 );
		let exitCode: number;
		let stdout: string;
		let stderr: string;
		try {
			[ exitCode, stdout, stderr ] = await Promise.all( [
				command.response.exitCode,
				command.response.stdoutText,
				command.response.stderrText,
			] );
		} finally {
			clearInterval( progressTimer );
		}
		if ( exitCode !== 0 ) {
			throw new LoggerError(
				__( 'Static site import failed.' ),
				new Error(
					stderr.trim() || stdout.trim() || sprintf( __( 'WP-CLI exited with code %d.' ), exitCode )
				)
			);
		}

		if ( ! fs.existsSync( resultPath ) ) {
			throw new LoggerError(
				__( 'Static site import completed without a result receipt.' ),
				new Error( __( 'The importer did not write .studio-import/result.json.' ) )
			);
		}
		let result: {
			continuation?: boolean;
			canonicalization_pending?: boolean;
			completed_routes?: number;
			total_routes?: number;
		};
		try {
			result = JSON.parse( fs.readFileSync( resultPath, 'utf-8' ) );
		} catch ( error ) {
			throw new LoggerError( __( 'Static site import returned an invalid result.' ), error );
		} finally {
			if ( ! preserveResult ) fs.rmSync( resultPath, { force: true } );
		}
		if ( ! result.continuation ) {
			if ( result.canonicalization_pending ) {
				const startForCanonicalization = ! site.running;
				if ( startForCanonicalization ) {
					await connectToDaemon();
					await startWordPressServer( site, logger );
					site.running = true;
				}
				try {
					try {
						await canonicalizeStaticSiteImport( site, stagingDir );
					} finally {
						try {
							await cleanupValidatorPages();
						} finally {
							await closeSharedBrowser();
						}
					}
				} finally {
					if ( startForCanonicalization ) {
						await stopWordPressServer( site.id );
						site.running = false;
					}
				}
			}
			break;
		}
		logger.reportSuccess(
			sprintf(
				__( 'Static site import progress: %1$d/%2$d routes' ),
				result.completed_routes ?? 0,
				result.total_routes ?? 0
			)
		);
		if ( invocation === MAX_STATIC_SITE_IMPORT_INVOCATIONS ) {
			throw new LoggerError( __( 'Static site import exceeded its continuation limit.' ) );
		}
	}
	logger.reportSuccess( __( 'Static site imported successfully' ) );
	if ( identity ) {
		fs.writeFileSync(
			staticSiteImportIdentityPath( site.path ),
			JSON.stringify( { ...identity, phase: 'cleanup_pending' } )
		);
	}
	return cleanupStaticSiteImporterPlugin( site );
}

async function cleanupStaticSiteImporterPlugin( site: SiteData ): Promise< boolean > {
	try {
		await using command = await runWpCliCommandWithMessaging( site, [
			'eval',
			`require_once ABSPATH . 'wp-admin/includes/plugin.php';
require_once ABSPATH . 'wp-admin/includes/file.php';
$plugin = 'static-site-importer/static-site-importer.php';
if ( is_plugin_active( $plugin ) ) {
	deactivate_plugins( $plugin, true );
}
if ( file_exists( WP_PLUGIN_DIR . '/' . $plugin ) ) {
	$result = delete_plugins( array( $plugin ) );
	if ( is_wp_error( $result ) ) {
		throw new RuntimeException( $result->get_error_message() );
	}
}`,
		] );
		const [ exitCode, stdout, stderr ] = await Promise.all( [
			command.response.exitCode,
			command.response.stdoutText,
			command.response.stderrText,
		] );
		if ( exitCode !== 0 ) {
			throw new Error(
				stderr.trim() || stdout.trim() || sprintf( __( 'WP-CLI exited with code %d.' ), exitCode )
			);
		}
		return true;
	} catch ( error ) {
		logger.reportError(
			new LoggerError(
				__(
					'Static Site Importer cleanup failed. The imported site and resumable import state were preserved.'
				),
				error
			),
			false
		);
		return false;
	}
}

function resumableStaticSiteImportPhase(
	sitePath: string,
	code: string,
	identity: StaticSiteImportIdentity | undefined
): 'import' | 'cleanup_pending' | null {
	if ( ! identity ) {
		return null;
	}
	const scriptPath = path.join( sitePath, '.studio-import', 'import.php' );
	const identityPath = staticSiteImportIdentityPath( sitePath );
	if ( ! fs.existsSync( scriptPath ) || ! fs.existsSync( identityPath ) ) {
		return null;
	}
	try {
		const persistedIdentity = JSON.parse( fs.readFileSync( identityPath, 'utf-8' ) );
		if (
			persistedIdentity?.url !== identity.url ||
			persistedIdentity?.contract !== identity.contract ||
			fs.readFileSync( scriptPath, 'utf-8' ) !== code
		) {
			return null;
		}
		return persistedIdentity.phase === 'cleanup_pending' ? 'cleanup_pending' : 'import';
	} catch {
		return null;
	}
}

export async function runCommand(
	sitePath: string,
	options: CreateCommandOptions
): Promise< void > {
	const siteRuntime = options.runtime;
	if ( ! isFileAccessAllowedForRuntime( siteRuntime, options.fileAccess ) ) {
		throw new LoggerError(
			__(
				'File access "all-files" requires the native PHP runtime. The sandbox only has access to the site directory.'
			)
		);
	}
	const phpVersion = validateSupportedPhpVersion( options.phpVersion );
	const isOnlineStatus = await isOnline();
	const staticSiteImport = options.blueprint?.staticSiteImport;
	let resumedStaticSiteImport = false;
	let staticSiteImportSucceeded = false;
	let staticSiteImportResultObserved = false;
	let registeredSite = false;

	try {
		if ( isOnlineStatus ) {
			const updated = await updateServerFiles();
			if ( updated ) {
				logger.reportSuccess( __( 'Dependencies updated' ) );
			}
		}
	} catch ( error ) {
		// Errors here aren't critical and likely relate to things outside the user's control,
		// like network issues or bad API responses. Report them only in development.
		if ( process.env.NODE_ENV !== 'production' ) {
			const loggerError = new LoggerError( 'Failed to update dependencies', error );
			logger.reportError( loggerError, false );
		}
	}

	const createStartedAt = Date.now();

	try {
		logger.reportStart( LoggerAction.VALIDATE, __( 'Validating site configuration…' ) );

		const pathExistsResult = await pathExists( sitePath );
		const isEmptyDirResult = pathExistsResult && ( await isEmptyDir( sitePath ) );
		const isWordPressDirResult = pathExistsResult && isWordPressDirectory( sitePath );

		if ( pathExistsResult && ! isEmptyDirResult && ! isWordPressDirResult ) {
			throw new LoggerError(
				__( 'The selected directory is not empty nor an existing WordPress site.' )
			);
		}

		let blueprintUri: string | undefined;
		let blueprint: BlueprintV1Declaration | undefined;
		let blueprintCredentials: { adminUsername?: string; adminPassword?: string } | null = null;

		if ( options.blueprint ) {
			const validation = await validateBlueprintData( options.blueprint.contents );
			if ( ! validation.valid ) {
				throw new LoggerError( validation.error );
			}

			// `validateBlueprintData()` does not give us a proper type guard, but in reality, it ensures
			// `options.blueprint.contents` conforms to the `BlueprintV1Declaration` schema.
			const formValues = extractFormValuesFromBlueprint(
				options.blueprint.contents as BlueprintV1Declaration
			);
			if ( formValues.adminUsername || formValues.adminPassword ) {
				blueprintCredentials = {
					adminUsername: formValues.adminUsername,
					adminPassword: formValues.adminPassword,
				};
			}

			blueprintUri = options.blueprint.uri;
			blueprint = options.blueprint.contents as BlueprintV1Declaration;

			const blueprintHasMultisite = blueprint?.steps
				?.filter( isStepDefinition )
				.some( ( step ) => step.step === 'enableMultisite' );

			if ( blueprintHasMultisite && ! options.customDomain ) {
				throw new LoggerError(
					__(
						'The enableMultisite Blueprint step requires a custom domain. WordPress multisite does not support custom ports. Use --domain <name>.local to set a custom domain.'
					)
				);
			}
		}

		const cliConfig = await readCliConfig();
		const existingSite = cliConfig.sites.find( ( site ) => arePathsEqual( site.path, sitePath ) );
		registeredSite = Boolean( existingSite );
		const resumePhase =
			existingSite && staticSiteImport
				? resumableStaticSiteImportPhase(
						sitePath,
						staticSiteImport.code,
						staticSiteImport.identity
				  )
				: null;
		if ( existingSite && staticSiteImport && resumePhase ) {
			resumedStaticSiteImport = true;
			try {
				staticSiteImportSucceeded =
					resumePhase === 'cleanup_pending'
						? await cleanupStaticSiteImporterPlugin( existingSite )
						: await runStaticSiteImport(
								existingSite,
								staticSiteImport.code,
								staticSiteImport.source,
								staticSiteImport.stagedSource,
								staticSiteImport.identity,
								staticSiteImport.storeResult
						  );
				staticSiteImportResultObserved = true;
			} catch ( error ) {
				throw new LoggerError( __( 'Failed to import static site' ), error );
			}
			if ( staticSiteImportSucceeded ) {
				cleanupSuccessfulStaticSiteImport( sitePath, staticSiteImport.storeResult );
			}
			return;
		}
		if ( existingSite ) {
			throw new LoggerError( __( 'The selected directory is already in use.' ) );
		}

		for ( const site of cliConfig.sites ) {
			portFinder.addUnavailablePort( site.port );
		}

		if ( options.customDomain ) {
			const existingDomains = cliConfig.sites
				.map( ( site ) => site.customDomain )
				.filter( ( domain ): domain is string => Boolean( domain ) );
			const domainError = getDomainNameValidationError(
				true,
				options.customDomain,
				existingDomains
			);
			if ( domainError ) {
				throw new LoggerError( domainError );
			}
		}

		logger.reportSuccess( __( 'Site configuration validated' ) );

		if ( ! pathExistsResult ) {
			logger.reportStart( LoggerAction.CREATE_DIRECTORY, __( 'Creating site directory…' ) );
			fs.mkdirSync( sitePath, { recursive: true } );
			logger.reportSuccess( __( 'Site directory created' ) );
		}

		if ( options.wpVersion === 'latest' ) {
			const bundledWPPath = path.join( getServerFilesPath(), 'wordpress-versions', 'latest' );

			if ( ! ( await pathExists( bundledWPPath ) ) ) {
				throw new LoggerError(
					__(
						'Cannot set up WordPress. Bundled WordPress files not found. Please connect to the internet or reinstall Studio.'
					)
				);
			}

			logger.reportStart( LoggerAction.SETUP_WORDPRESS, __( 'Copying bundled WordPress…' ) );
			await recursiveCopyDirectory( bundledWPPath, sitePath );
			logger.reportSuccess( __( 'WordPress files copied' ) );
		} else if ( ! isOnlineStatus ) {
			throw new LoggerError(
				__(
					'Cannot set up WordPress while offline. Specific WordPress versions require an internet connection. Try using "latest" version or ensure internet connectivity.'
				)
			);
		} else if ( siteRuntime === SITE_RUNTIME_NATIVE_PHP && ! isWordPressDirResult ) {
			logger.reportStart(
				LoggerAction.SETUP_WORDPRESS,
				sprintf( __( 'Downloading WordPress %s…' ), options.wpVersion )
			);
			await downloadWordPress( options.wpVersion );
			logger.reportSuccess( __( 'WordPress files downloaded' ) );

			logger.reportStart(
				LoggerAction.SETUP_WORDPRESS,
				sprintf( __( 'Copying WordPress %s…' ), options.wpVersion )
			);
			await recursiveCopyDirectory( getWordPressVersionPath( options.wpVersion ), sitePath );
			logger.reportSuccess( __( 'WordPress files copied' ) );
		}

		logger.reportStart( LoggerAction.INSTALL_SQLITE, __( 'Setting up SQLite integration…' ) );
		await keepSqliteIntegrationUpdated( sitePath );
		logger.reportSuccess( __( 'SQLite integration configured' ) );

		try {
			const sharedConfig = await readSharedConfig();
			const selectedSkills = sharedConfig.selectedSkills ?? [];
			await installAiInstructionsToSite(
				{ path: sitePath, runtime: siteRuntime },
				getAiInstructionsPath(),
				selectedSkills
			);
		} catch ( error ) {
			logger.reportError(
				new LoggerError( __( 'Failed to install AI instructions. Proceeding anyway…' ), error ),
				false
			);
		}

		logger.reportStart( LoggerAction.ASSIGN_PORT, __( 'Assigning port…' ) );
		const port = await portFinder.getOpenPort();
		// translators: %d is the port number
		logger.reportSuccess( sprintf( __( 'Port assigned: %d' ), port ) );

		const siteName = options.name || path.basename( sitePath );
		const siteId = options.siteId || crypto.randomUUID();

		// Determine admin credentials: CLI args > Blueprint > defaults
		// External passwords need to be encoded; createPassword() already returns encoded
		const adminUsername = options.adminUsername || blueprintCredentials?.adminUsername || undefined;
		if ( adminUsername ) {
			const usernameError = validateAdminUsername( adminUsername );
			if ( usernameError ) {
				throw new LoggerError( usernameError );
			}
		}
		const adminEmail = options.adminEmail?.trim() || undefined;
		if ( adminEmail ) {
			const emailError = validateAdminEmail( adminEmail );
			if ( emailError ) {
				throw new LoggerError( emailError );
			}
		}

		const externalPassword = options.adminPassword || blueprintCredentials?.adminPassword;
		const adminPassword = externalPassword ? encodePassword( externalPassword ) : createPassword();

		const siteLanguage = await getPreferredSiteLanguage( options.wpVersion );

		if (
			siteLanguage &&
			siteLanguage !== DEFAULT_LOCALE &&
			options.wpVersion === DEFAULT_WORDPRESS_VERSION
		) {
			await copyLanguagePackToSite( sitePath, siteLanguage );
		}

		const siteDetails: SiteData = {
			id: siteId,
			name: siteName,
			path: sitePath,
			adminUsername,
			adminPassword,
			adminEmail,
			port,
			phpVersion,
			runtime: siteRuntime,
			fileAccess: options.fileAccess,
			running: false,
			status: 'ready',
			isWpAutoUpdating: options.wpVersion === DEFAULT_WORDPRESS_VERSION,
			customDomain: options.customDomain,
			enableHttps: options.enableHttps,
			landingPage: normalizeLandingPage( blueprint?.landingPage ),
		};

		logger.reportStart( LoggerAction.SAVE_SITE, __( 'Saving site…' ) );

		try {
			await lockCliConfig();
			const userData = await readCliConfig();

			userData.sites.push( siteDetails );
			sortSites( userData.sites );

			await saveCliConfig( userData );
			logger.reportSuccess( __( 'Site created successfully' ) );
		} finally {
			await unlockCliConfig();
		}

		if ( ! options.noStart ) {
			logger.reportStart( LoggerAction.START_DAEMON, __( 'Starting process daemon…' ) );
			await connectToDaemon();
			logger.reportSuccess( __( 'Process daemon started' ) );

			await setupCustomDomain( siteDetails, logger );

			const startMessage = blueprint
				? __( 'Starting WordPress server and applying Blueprint…' )
				: __( 'Starting WordPress server…' );
			logger.reportStart( LoggerAction.START_SITE, startMessage );
			try {
				await startWordPressServer( siteDetails, logger, {
					wpVersion: options.wpVersion,
					blueprint,
					blueprintUri,
					siteLanguage,
				} );
				logger.reportSuccess( __( 'WordPress server started' ) );

				stripWpConfigDbConstants( sitePath );

				siteDetails.running = true;
				siteDetails.url = siteDetails.customDomain
					? `${ siteDetails.enableHttps ? 'https' : 'http' }://${ siteDetails.customDomain }`
					: `http://localhost:${ siteDetails.port }`;

				if ( staticSiteImport ) {
					staticSiteImportResultObserved = true;
					staticSiteImportSucceeded = await runStaticSiteImport(
						siteDetails,
						staticSiteImport.code,
						staticSiteImport.source,
						staticSiteImport.stagedSource,
						staticSiteImport.identity,
						staticSiteImport.storeResult
					);
				}

				if ( ! options.skipLogDetails ) {
					logSiteDetails( siteDetails );
				}
				if ( ! options.skipBrowser ) {
					await openSiteInBrowser( siteDetails );
				}
			} catch ( error ) {
				if ( ! staticSiteImportResultObserved ) {
					await removeSiteFromConfig( siteDetails.id );
					if ( ! isWordPressDirResult ) {
						await fs.promises.rm( sitePath, { recursive: true, force: true } );
					}
				}
				throw new LoggerError(
					staticSiteImport
						? __( 'Failed to import static site' )
						: __( 'Failed to start WordPress server' ),
					error
				);
			}
		} else {
			if ( blueprint ) {
				logger.reportStart( LoggerAction.START_DAEMON, __( 'Starting process daemon…' ) );
				await connectToDaemon();
				logger.reportSuccess( __( 'Process daemon started' ) );

				logger.reportStart( LoggerAction.START_SITE, __( 'Applying Blueprint…' ) );
				try {
					if ( ! blueprintUri ) {
						throw new LoggerError( __( 'Blueprint source path is missing' ) );
					}
					await runBlueprint( siteDetails, logger, {
						wpVersion: options.wpVersion,
						blueprint,
						blueprintUri,
						siteLanguage,
					} );
					logger.reportSuccess( __( 'Blueprint applied successfully' ) );

					stripWpConfigDbConstants( sitePath );
					if ( staticSiteImport ) {
						staticSiteImportResultObserved = true;
						staticSiteImportSucceeded = await runStaticSiteImport(
							siteDetails,
							staticSiteImport.code,
							staticSiteImport.source,
							staticSiteImport.stagedSource,
							staticSiteImport.identity,
							staticSiteImport.storeResult
						);
					}
				} catch ( error ) {
					if ( ! staticSiteImportResultObserved ) {
						await removeSiteFromConfig( siteDetails.id );
						if ( ! isWordPressDirResult ) {
							await fs.promises.rm( sitePath, { recursive: true, force: true } );
						}
					}
					throw new LoggerError(
						staticSiteImport
							? __( 'Failed to import static site' )
							: __( 'Failed to apply Blueprint' ),
						error
					);
				}
			}
			console.log( '' );
			console.log( __( 'Site created successfully' ) );
			console.log( '' );
			if ( ! options.skipLogDetails ) {
				logSiteDetails( siteDetails );
			}
			console.log( __( 'Run "studio start" to start the site.' ) );
		}

		logger.reportKeyValuePair( 'id', siteDetails.id );
		logger.reportKeyValuePair( 'port', String( siteDetails.port ) );
		logger.reportKeyValuePair( 'running', String( siteDetails.running ) );

		// Tracks: the CLI is the sole emitter of site-creation, so every path a site comes into
		// existence (new/blueprint/import/sync/duplicate, app-spawned or standalone) is counted once.
		// Fires only on success; wrapped so best-effort telemetry can never fail a site creation.
		try {
			await recordTracksEvent( TRACKS_EVENTS.SITE_CREATE, {
				flow_type: options.flowType ?? ( blueprint ? 'blueprint' : 'new' ),
				php_version: siteDetails.phpVersion,
				wp_version: getWordPressVersion( sitePath ),
				custom_domain: !! options.customDomain,
				ssl_enabled: !! options.enableHttps,
				time_ms: Date.now() - createStartedAt,
				...getTracksOrigin(),
			} );
		} catch {
			// Best-effort telemetry — never block or fail a site creation.
		}

		await emitCliEvent( { event: SITE_EVENTS.CREATED, data: { siteId: siteDetails.id } } );
	} finally {
		if ( staticSiteImport && staticSiteImportSucceeded ) {
			cleanupSuccessfulStaticSiteImport( sitePath, staticSiteImport.storeResult );
		} else if (
			staticSiteImport &&
			! resumedStaticSiteImport &&
			! registeredSite &&
			! staticSiteImportResultObserved
		) {
			fs.rmSync( path.join( sitePath, '.studio-import' ), { recursive: true, force: true } );
		}
		await disconnectFromDaemon();
	}
}

async function fetchBlueprint( url: string ) {
	const res = await fetch( url );

	if ( ! res.ok ) {
		throw new LoggerError( __( 'Failed to fetch Blueprint' ) );
	}

	try {
		return await res.json();
	} catch ( error ) {
		throw new LoggerError( __( 'Failed to parse Blueprint JSON' ), error );
	}
}

function stripWpConfigDbConstants( sitePath: string ): void {
	const wpConfigPath = path.join( sitePath, 'wp-config.php' );
	if ( ! fs.existsSync( wpConfigPath ) ) {
		return;
	}
	const content = fs.readFileSync( wpConfigPath, 'utf-8' );
	if ( hasDefaultDbBlock( content ) ) {
		fs.writeFileSync( wpConfigPath, removeDbConstants( content ), 'utf-8' );
	}
}

function readBlueprint( blueprintPath: string ) {
	if ( ! fs.existsSync( blueprintPath ) ) {
		throw new LoggerError( sprintf( __( 'Blueprint file not found: %s' ), blueprintPath ) );
	}

	try {
		const blueprintContent = fs.readFileSync( blueprintPath, 'utf-8' );
		return JSON.parse( blueprintContent );
	} catch ( error ) {
		throw new LoggerError(
			sprintf( __( 'Failed to parse Blueprint JSON file: %s' ), blueprintPath ),
			error
		);
	}
}

function coerceSiteId( value: string ) {
	// Validate UUID format (8-4-4-4-12 hex characters)
	const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
	if ( ! uuidRegex.test( value ) ) {
		throw new ValidationError( 'id', value, __( 'Must be a valid UUID' ) );
	}
	return value;
}

function coerceWpVersion( value: string ) {
	if ( ! isValidWordPressVersion( value ) ) {
		throw new ValidationError(
			'wp',
			value,
			__(
				'Must be: "latest", "nightly", or a valid version number (e.g., "6.4", "6.4.1", "6.4-beta1")'
			)
		);
	}

	if ( ! isWordPressVersionAtLeast( value, MINIMUM_WORDPRESS_VERSION ) ) {
		throw new ValidationError(
			'wp',
			value,
			sprintf( __( 'Must be: at least %s' ), MINIMUM_WORDPRESS_VERSION )
		);
	}

	return value;
}

export const registerCommand = (
	yargs: StudioArgv,
	dependencies: { capture?: typeof captureUrl } = {}
) => {
	return yargs.command( {
		command: 'create',
		describe: __( 'Create a new site' ),
		builder: ( yargs ) => {
			return yargs
				.option( 'id', {
					type: 'string',
					describe: __( 'Site ID (UUID format, used internally by Studio app)' ),
					hidden: true,
					coerce: coerceSiteId,
				} )
				.option( 'name', {
					type: 'string',
					describe: __( 'Site name' ),
				} )
				.option( 'wp', {
					type: 'string',
					describe: __( 'WordPress version (e.g., "latest", "6.4", "6.4.1")' ),
					defaultDescription: DEFAULT_WORDPRESS_VERSION,
					coerce: coerceWpVersion,
				} )
				.option( 'php', {
					type: 'string',
					describe: __( 'PHP version' ),
					choices: SupportedPHPVersions,
					defaultDescription: RecommendedPHPVersion,
				} )
				.option( 'runtime', {
					type: 'string',
					describe: __(
						'Run the site with native PHP ("native") or in the Playground sandbox ("sandbox")'
					),
					choices: [ SITE_MODE_NATIVE, SITE_MODE_SANDBOX ] as const,
					default: SITE_MODE_NATIVE,
				} )
				.option( 'file-access', {
					type: 'string',
					describe: __(
						'Which files PHP can access with the native PHP runtime: the site directory only, or all files'
					),
					choices: [ SITE_FILE_ACCESS_SITE_DIRECTORY, SITE_FILE_ACCESS_ALL_FILES ] as const,
					default: SITE_FILE_ACCESS_SITE_DIRECTORY,
				} )
				.option( 'domain', {
					type: 'string',
					describe: __( 'Custom domain (e.g., "mysite.local")' ),
				} )
				.option( 'https', {
					type: 'boolean',
					describe: __( 'Enable HTTPS for custom domain' ),
					implies: 'domain',
				} )
				.option( 'blueprint', {
					type: 'string',
					describe: __( 'Path or URL to Blueprint JSON file' ),
				} )
				.option( 'from', {
					type: 'string',
					describe: __( 'Create the site from a static import source' ),
					conflicts: 'blueprint',
					coerce: ( value ) => {
						if ( isUrl( value ) ) {
							return value;
						}

						return path.resolve( untildify( value ) );
					},
				} )
				.option( 'capture-output', {
					type: 'string',
					description: __( 'Directory for URL capture artifacts and diagnostics' ),
					coerce: ( value ) => path.resolve( untildify( value ) ),
				} )
				.option( 'resume-capture', {
					type: 'boolean',
					description: __( 'Resume an interrupted URL capture' ),
					default: false,
				} )
				.option( 'capture-screenshots', {
					type: 'boolean',
					description: __( 'Retain PNG visual evidence from URL capture' ),
					default: false,
				} )
				.option( 'static-site-importer-url', {
					type: 'string',
					describe: __( 'Static Site Importer plugin zip URL for --from imports' ),
					defaultDescription: DEFAULT_STATIC_SITE_IMPORTER_PLUGIN_URL,
					conflicts: 'static-site-importer-path',
				} )
				.option( 'static-site-importer-path', {
					type: 'string',
					describe: __( 'Local Static Site Importer plugin zip for --from imports' ),
					conflicts: 'static-site-importer-url',
					coerce: ( value ) => {
						const pluginPath = path.resolve( untildify( value ) );
						if ( path.extname( pluginPath ).toLowerCase() !== '.zip' ) {
							throw new ValidationError(
								'static-site-importer-path',
								value,
								__( 'Must be a .zip file' )
							);
						}
						try {
							if ( ! fs.statSync( pluginPath ).isFile() ) {
								throw new Error();
							}
						} catch {
							throw new ValidationError(
								'static-site-importer-path',
								value,
								__( 'Must be an existing regular .zip file' )
							);
						}
						return pluginPath;
					},
				} )
				.option( 'store-import-result', {
					type: 'boolean',
					describe: __( 'Store the import result in the created site database' ),
					default: false,
				} )
				.option( 'original-blueprint-path', {
					type: 'string',
					hidden: true,
				} )
				.option( 'admin-username', {
					type: 'string',
					describe: __( 'Admin username (defaults to "admin")' ),
				} )
				.option( 'admin-password', {
					type: 'string',
					describe: __(
						'Admin password (auto-generated if not provided). Note: passwords in CLI arguments may be visible in process lists; consider using a Blueprint file for sensitive passwords.'
					),
				} )
				.option( 'admin-email', {
					type: 'string',
					describe: __( 'Admin email (defaults to "admin@localhost.com")' ),
				} )
				.option( 'start', {
					type: 'boolean',
					describe: __( 'Start the site after creation' ),
					default: true,
				} )
				.option( 'skip-browser', {
					type: 'boolean',
					describe: __( 'Skip opening the site in browser after starting' ),
					default: false,
				} )
				.option( 'skip-log-details', {
					type: 'boolean',
					describe: __( 'Skip printing site URL and admin credentials after creating' ),
					default: false,
				} )
				.option( 'flow-type', {
					// Internal telemetry hint for the `studio_site_created` Tracks event, set by the
					// desktop app when it spawns the CLI. Hidden from `--help`.
					type: 'string',
					hidden: true,
				} );
		},
		handler: async ( argv ) => {
			const artifact =
				argv.from && ! isUrl( argv.from ) && path.extname( argv.from ).toLowerCase() === '.json'
					? readSiteArtifact( argv.from )
					: undefined;
			let siteName = argv.name ?? ( artifact ? artifactTitle( artifact ) : undefined );
			let sitePath = argv.path;
			let wpVersion = argv.wp;
			let phpVersion = argv.php;
			let customDomain = argv.domain;
			let enableHttps = !! argv.https;
			let adminUsername = argv.adminUsername;
			let adminPassword = argv.adminPassword;
			let adminEmail = argv.adminEmail;
			const runtime = siteRuntimeFromMode( argv.runtime );
			const fileAccess = argv.fileAccess;
			if ( ! isFileAccessAllowedForRuntime( runtime, fileAccess ) ) {
				logger.reportError(
					new LoggerError(
						__(
							'File access "all-files" requires the native PHP runtime. The sandbox only has access to the site directory.'
						)
					)
				);
				return;
			}

			// Validate and resolve the WordPress version against available versions before prompting
			if ( wpVersion && wpVersion !== 'latest' && wpVersion !== 'nightly' ) {
				try {
					logger.reportStart( LoggerAction.VALIDATE, __( 'Checking WordPress version…' ) );
					const availableVersions = await fetchWordPressVersions();
					const matchedVersion = availableVersions.find(
						( v ) => v.value === wpVersion || v.value.startsWith( wpVersion + '.' )
					);
					if ( ! matchedVersion ) {
						const versionLabels = availableVersions
							.filter( ( v ) => v.value !== 'latest' )
							.map( ( v ) => v.label );
						logger.reportError(
							new LoggerError(
								sprintf(
									/* translators: %1$s: requested version, %2$s: list of available versions */
									__( 'WordPress version "%1$s" is not available. Available versions: %2$s' ),
									wpVersion,
									versionLabels.join( ', ' )
								)
							)
						);
						return;
					}
					// Resolve short versions to full versions (e.g. "6.7" → "6.7.2")
					if ( matchedVersion.value !== wpVersion ) {
						logger.reportSuccess(
							sprintf(
								/* translators: %1$s: requested version, %2$s: resolved version */
								__( 'WordPress version: %1$s → %2$s' ),
								wpVersion,
								matchedVersion.value
							)
						);
					} else {
						logger.reportSuccess(
							sprintf(
								/* translators: %s: WordPress version */
								__( 'WordPress version: %s' ),
								wpVersion
							)
						);
					}
					wpVersion = matchedVersion.value;
				} catch {
					// If we can't fetch versions (network issue), let it proceed and fail later
				}
			}

			try {
				if ( process.stdin.isTTY ) {
					if ( ! siteName ) {
						const defaultName = await generateSiteName();
						siteName = await input( {
							message: __( 'Site name:' ),
							default: defaultName,
						} );
					}

					const pathWasExplicitlyProvided = sitePath !== process.cwd();
					if ( ! pathWasExplicitlyProvided ) {
						const suggestedPath = getDefaultSitePath( siteName || __( 'My WordPress Website' ) );
						const promptedPath = await input( {
							message: __( 'Site path:' ),
							default: suggestedPath,
						} );
						sitePath = path.resolve( untildify( promptedPath ) );
					}

					if ( ! wpVersion ) {
						let wpChoices: { name: string; value: string }[];
						try {
							const versions = await fetchWordPressVersions();
							wpChoices = versions.map( ( v ) => ( {
								name: v.value === 'latest' ? `latest (${ v.label })` : v.label,
								value: v.value,
							} ) );
						} catch {
							// Offline or API failure — offer only "latest"
							wpChoices = [
								{
									name: __( 'Latest (recommended)' ),
									value: 'latest',
								},
							];
						}
						wpVersion = await select( {
							message: __( 'WordPress version:' ),
							choices: wpChoices,
							default: DEFAULT_WORDPRESS_VERSION,
							loop: false,
						} );
					}

					if ( ! phpVersion ) {
						phpVersion = await select( {
							message: __( 'PHP version:' ),
							choices: SupportedPHPVersions.map( ( v ) => ( {
								name: v === RecommendedPHPVersion ? sprintf( __( '%s (recommended)' ), v ) : v,
								value: v,
							} ) ),
							default: RecommendedPHPVersion,
						} );
					}

					if ( ! customDomain ) {
						const cliConfig = await readCliConfig();
						const existingDomains = cliConfig.sites
							.map( ( site ) => site.customDomain )
							.filter( ( domain ): domain is string => Boolean( domain ) );

						customDomain = await input( {
							message: __( 'Custom domain (leave empty to skip):' ),
							validate: ( value ) =>
								getDomainNameValidationError( !! value, value, existingDomains ) || true,
						} );
					}

					if ( customDomain && ! argv.https ) {
						enableHttps = await confirm( {
							message: __( 'Enable HTTPS?' ),
							default: false,
						} );
					}

					if ( ! adminUsername ) {
						adminUsername = await input( {
							message: __( 'Admin username:' ),
							default: 'admin',
							validate: ( value ) => validateAdminUsername( value ) || true,
						} );
					}

					if ( ! adminPassword ) {
						adminPassword = await password( {
							message: __( 'Admin password (leave empty to auto-generate):' ),
							mask: true,
						} );
						if ( ! adminPassword ) {
							adminPassword = undefined;
						}
					}

					if ( ! adminEmail ) {
						adminEmail = await input( {
							message: __( 'Admin email:' ),
							default: 'admin@localhost.com',
							validate: ( value ) => validateAdminEmail( value ) || true,
						} );
					}
				}
			} catch {
				// User cancelled the prompt (Ctrl+C)
				return;
			}

			// Apply defaults for non-interactive mode when flags weren't provided
			wpVersion = wpVersion ?? DEFAULT_WORDPRESS_VERSION;

			const config: CreateCommandOptions = {
				name: siteName,
				siteId: argv.id,
				wpVersion,
				phpVersion: phpVersion ?? RecommendedPHPVersion,
				runtime,
				fileAccess,
				customDomain,
				enableHttps,
				adminUsername,
				adminPassword,
				adminEmail,
				noStart: ! argv.start,
				skipBrowser: !! argv.skipBrowser,
				skipLogDetails: !! argv.skipLogDetails,
				flowType: parseFlowType( argv.flowType ),
			};

			try {
				let importSource = argv.from;
				const sourceUrl = importSource && isUrl( importSource ) ? importSource : undefined;
				if ( sourceUrl ) {
					const captureOutput =
						argv.captureOutput ??
						path.join( path.dirname( sitePath ), `${ path.basename( sitePath ) }-capture` );
					logger.reportStart( LoggerAction.IMPORT_SITE, __( 'Capturing source website…' ) );
					const capture = await ( dependencies.capture ?? captureUrl )( sourceUrl, captureOutput, {
						resume: argv.resumeCapture,
						captureImages: argv.captureScreenshots,
						onProgress: ( progress ) => logger.reportProgress( captureProgressMessage( progress ) ),
					} );
					logger.reportSuccess( __( 'Source website captured' ) );
					importSource = capture.artifactPath;
				}

				if ( importSource ) {
					config.blueprint = buildCreateFromSourceBlueprint(
						importSource,
						siteName || __( 'Imported Site' ),
						argv.staticSiteImporterPath
							? { path: argv.staticSiteImporterPath }
							: argv.staticSiteImporterUrl ?? DEFAULT_STATIC_SITE_IMPORTER_PLUGIN_URL,
						argv.storeImportResult,
						adminUsername ?? 'admin',
						sourceUrl
					);
				} else if ( argv.blueprint ) {
					if ( argv.blueprint.startsWith( 'http://' ) || argv.blueprint.startsWith( 'https://' ) ) {
						config.blueprint = {
							uri: argv.blueprint,
							contents: await fetchBlueprint( argv.blueprint ),
						};
					} else {
						const uri = path.resolve( untildify( argv.blueprint ) );

						config.blueprint = {
							uri,
							contents: readBlueprint( uri ),
						};

						// When invoked by the desktop app, the blueprint contents come from a temp file
						// but resources should be resolved relative to the original file location.
						// For gallery blueprints the path is a URL; use it directly.
						if ( argv.originalBlueprintPath ) {
							const originalPath = argv.originalBlueprintPath;
							config.blueprint.uri =
								originalPath.startsWith( 'http://' ) || originalPath.startsWith( 'https://' )
									? originalPath
									: path.resolve( originalPath );
						}
					}
				}

				try {
					await runCommand( sitePath, config );
				} finally {
					if ( config.blueprint?.staticSiteImport?.bundlePath ) {
						fs.rmSync( config.blueprint.staticSiteImport.bundlePath, {
							recursive: true,
							force: true,
						} );
					}
				}

				if ( __ENABLE_CLI_TELEMETRY__ && ! argv.avoidTelemetry ) {
					bumpStat(
						__IS_PACKAGED_FOR_NPM__
							? StatsGroup.STUDIO_CLI_SITE_CREATE_NPM
							: StatsGroup.STUDIO_CLI_SITE_CREATE_APP,
						getPlatformMetric()
					);
				}
			} catch ( error ) {
				if ( error instanceof LoggerError ) {
					logger.reportError( error );
				} else {
					const loggerError = new LoggerError( __( 'Failed to create site' ), error );
					logger.reportError( loggerError );
				}
			}
		},
	} );
};
