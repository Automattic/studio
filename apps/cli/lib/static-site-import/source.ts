import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import {
	createBlueprintTempDirSync,
	removeBlueprintTempDirSync,
} from '@studio/common/lib/blueprint-bundle';
import { type TracksSiteCreateSource } from '@studio/common/lib/record-tracks-event';
import { __, sprintf } from '@wordpress/i18n';
import { LoggerError } from 'cli/logger';
import type { BlueprintV1Declaration } from '@wp-playground/blueprints';

// Without an explicit importer, `--from` installs the newest Static Site Importer release (see
// `cli/lib/import-runtime`), which vendors the matching Blocks Engine. To run an unreleased build, pass a paired zip
// from the importer's `npm run build:dev-package` to `--static-site-importer-path`.
export const SSI_PLUGIN_SLUG = 'static-site-importer';
const DATA_LIBERATION_CAPTURE_RECEIPT_SCHEMA = 'blocks-engine-capture/capture-receipt/v1';
type StaticSiteImporterSource = {
	path: string;
	payload: Record< string, unknown >;
	stagedSourcePath?: string;
};

export type StaticSiteImporterPlugin = string | { path: string };

/** The import a create-from-source Blueprint carries, run once the importer is installed. */
export type StaticSiteImportPlan = {
	request: string;
	bundlePath?: string;
	sourcePath?: string;
};

export type StaticSiteImportBlueprint = {
	contents: BlueprintV1Declaration;
	uri: string;
	staticSiteImport: StaticSiteImportPlan;
};

function readSiteArtifact( artifactPath: string ): Record< string, unknown > {
	if ( ! fs.existsSync( artifactPath ) ) {
		throw new LoggerError( sprintf( __( 'Artifact file not found: %s' ), artifactPath ) );
	}

	try {
		const artifact = JSON.parse( fs.readFileSync( artifactPath, 'utf-8' ) );
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

export function isUrl( value: string ): boolean {
	return value.startsWith( 'http://' ) || value.startsWith( 'https://' );
}

function sourceFilePayload( filePath: string, relativePath: string ): Record< string, string > {
	return {
		path: relativePath.replace( /\\/g, '/' ),
		content_base64: fs.readFileSync( filePath ).toString( 'base64' ),
	};
}

export function isDataLiberationCaptureRoot( directory: string ): boolean {
	const receiptPath = path.join( directory, 'capture-receipt.json' );
	if ( ! fs.existsSync( receiptPath ) || ! fs.statSync( receiptPath ).isFile() ) {
		return false;
	}

	try {
		const receipt = JSON.parse( fs.readFileSync( receiptPath, 'utf-8' ) ) as {
			schema?: unknown;
		};
		return receipt.schema === DATA_LIBERATION_CAPTURE_RECEIPT_SCHEMA;
	} catch {
		return false;
	}
}

// Which bucket a `--from` source falls into, sent as `source` on `studio_site_created`. Mirrors the
// classification `prepareSourceImport()` performs on the same input: a URL is captured live, a
// capture root is an already-captured website, everything else is a plain local source.
export function classifySourceImport( source: string ): TracksSiteCreateSource {
	if ( isUrl( source ) ) {
		return 'url';
	}
	if ( isDataLiberationCaptureRoot( source ) ) {
		return 'capture';
	}
	return 'directory';
}

function resolveStaticSiteImporterSource( sourcePath: string ): StaticSiteImporterSource {
	if ( isUrl( sourcePath ) ) {
		throw new LoggerError(
			__( 'Remote URLs must be rendered by Data Liberation before SSI materialization.' )
		);
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
				return { path: artifactPath, payload: { artifact } };
			}
		}

		if ( fs.readdirSync( sourcePath ).length === 0 ) {
			throw new LoggerError( sprintf( __( 'Import source directory is empty: %s' ), sourcePath ) );
		}
		return { path: sourcePath, payload: {}, stagedSourcePath: sourcePath };
	}

	if ( ! stat.isFile() ) {
		throw new LoggerError(
			sprintf( __( 'Import source must be a file or directory: %s' ), sourcePath )
		);
	}

	const extension = path.extname( sourcePath ).toLowerCase();
	if ( extension === '.json' ) {
		return { path: sourcePath, payload: { artifact: readSiteArtifact( sourcePath ) } };
	}

	if ( extension === '.zip' ) {
		return {
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
		throw new LoggerError(
			__( 'Figma files are not supported by the canonical Static Site Importer command.' )
		);
	}

	return {
		path: sourcePath,
		payload: {
			files: [ sourceFilePayload( sourcePath, path.basename( sourcePath ) ) ],
		},
	};
}

function buildStaticSiteImporterRequest(
	source: StaticSiteImporterSource,
	siteName: string,
	originalSourceUrl?: string
): Record< string, unknown > {
	const payload = source.payload;
	let requestSource: Record< string, unknown >;
	let themeMaterialization: unknown;
	const artifact = payload.artifact;

	if ( source.stagedSourcePath ) {
		requestSource = { type: 'files', ref: 'request-bundle:source' };
	} else if ( artifact && typeof artifact === 'object' && ! Array.isArray( artifact ) ) {
		const {
			schema: _schema,
			entrypoint,
			files,
			theme_materialization,
			...metadata
		} = artifact as Record< string, unknown >;
		themeMaterialization = theme_materialization;
		requestSource = {
			type: 'files',
			entrypoint: typeof entrypoint === 'string' ? entrypoint : '',
			files: Array.isArray( files ) ? files : [],
			metadata,
		};
	} else if ( payload.archive && typeof payload.archive === 'object' ) {
		requestSource = { type: 'zip', zip: payload.archive };
	} else if ( Array.isArray( payload.files ) ) {
		requestSource = { type: 'files', files: payload.files };
	} else {
		throw new LoggerError( __( 'This source type is not supported by the canonical importer.' ) );
	}

	const request: Record< string, unknown > = {
		operation: 'apply',
		name: siteName,
		site_title: siteName,
		activate: true,
		overwrite: true,
		client_script_policy: 'isolated_preview',
		client_script_isolated: true,
		client_script_provenance: {
			ref: `studio-create-from:sha256:${ crypto
				.createHash( 'sha256' )
				.update( JSON.stringify( requestSource ) )
				.digest( 'hex' ) }`,
		},
		source_metadata: {
			source: 'studio-create-from',
			source_path: originalSourceUrl ?? source.path,
		},
		fail_on_quality: true,
		require_proven_dynamic_client_assets: true,
		seed_entities: true,
		materialize_dependencies: true,
		source: requestSource,
	};
	if ( themeMaterialization === 'block' || themeMaterialization === 'classic' ) {
		request.theme_materialization = themeMaterialization;
	}
	return request;
}

export function artifactTitle( artifact: Record< string, unknown > ): string | undefined {
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

export function capturedSourceTitle( captureRoot: string ): string | undefined {
	if ( ! isDataLiberationCaptureRoot( captureRoot ) ) return undefined;
	const title = readSiteArtifact( path.join( captureRoot, 'capture-receipt.json' ) ).title;
	return typeof title === 'string' && title.trim() ? title.trim() : undefined;
}

// An explicit name wins; a local source names itself when it is a titled artifact or a captured
// website. A URL is named from its capture once liberated.
export function sourceSiteName( source: string, name?: string ): string | undefined {
	if ( isUrl( source ) ) {
		return name;
	}
	const artifact =
		path.extname( source ).toLowerCase() === '.json' ? readSiteArtifact( source ) : undefined;
	return (
		name ?? ( artifact ? artifactTitle( artifact ) : undefined ) ?? capturedSourceTitle( source )
	);
}

export function buildCreateFromSourceBlueprint(
	sourcePath: string,
	siteName: string,
	staticSiteImporterPlugin: StaticSiteImporterPlugin,
	originalSourceUrl?: string
): StaticSiteImportBlueprint {
	const source = resolveStaticSiteImporterSource( sourcePath );
	const request = buildStaticSiteImporterRequest( source, siteName, originalSourceUrl );
	return importerBlueprint( staticSiteImporterPlugin, {
		request: `${ JSON.stringify( request, null, 2 ) }\n`,
		sourcePath: source.stagedSourcePath,
	} );
}

export function importerBlueprint(
	staticSiteImporterPlugin: StaticSiteImporterPlugin,
	staticSiteImport: Omit< StaticSiteImportPlan, 'bundlePath' >
): StaticSiteImportBlueprint {
	const tempDir = createBlueprintTempDirSync();
	const blueprintPath = path.join( tempDir, 'blueprint.json' );
	const pluginData =
		typeof staticSiteImporterPlugin === 'string'
			? { resource: 'url' as const, url: staticSiteImporterPlugin }
			: { resource: 'bundled' as const, path: `${ SSI_PLUGIN_SLUG }.zip` };
	const blueprint: BlueprintV1Declaration = {
		landingPage: '/',
		features: { networking: true },
		steps: [
			{
				step: 'installPlugin',
				pluginData,
				options: { activate: true, targetFolderName: SSI_PLUGIN_SLUG },
			},
		],
	};

	try {
		if ( typeof staticSiteImporterPlugin !== 'string' ) {
			fs.copyFileSync(
				staticSiteImporterPlugin.path,
				path.join( tempDir, `${ SSI_PLUGIN_SLUG }.zip` )
			);
		}
		fs.writeFileSync( blueprintPath, `${ JSON.stringify( blueprint, null, 2 ) }\n` );
	} catch ( error ) {
		removeBlueprintTempDirSync( tempDir );
		throw error;
	}
	return {
		contents: blueprint,
		uri: blueprintPath,
		staticSiteImport: { ...staticSiteImport, bundlePath: tempDir },
	};
}
