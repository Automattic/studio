import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import {
	createBlueprintTempDirSync,
	removeBlueprintTempDirSync,
} from '@studio/common/lib/blueprint-bundle';
import { __, sprintf } from '@wordpress/i18n';
import { SSI_PLUGIN_SLUG } from 'cli/lib/static-site-import/constants';
import { LoggerError } from 'cli/logger';
import type { BlueprintV1Declaration } from '@wp-playground/blueprints';

const DATA_LIBERATION_CAPTURE_RECEIPT_SCHEMA = 'blocks-engine-capture/capture-receipt/v1';
// JSON compiler-evidence sidecars written next to `website/`. Copied into the
// staged importer source and named in `metadata.reports` so SSI keeps them at
// the artifact root instead of prefixing `website/`. Large capture directories
// (`screenshots/`, `media/`, `resources/`, `layout-geometry/`) and `sections/`
// (forwarded separately) are excluded.
const ARTIFACT_ROOT_REPORT_FILES = [
	'capture-receipt.json',
	'asset-evidence.json',
	'breakpoints.json',
	'cleanup-evidence.json',
	'computed-styles.json',
	'css-variables.json',
	'diagnostics.json',
	'interaction-states.json',
	'layout-geometry-proof.json',
	'layout-geometry-report.json',
	'palette.json',
	'scroll-states.json',
	'source-profile.json',
	'typography.json',
] as const;

type StaticSiteImporterSource = {
	path: string;
	payload: Record< string, unknown >;
	stagedSourcePath?: string;
	stagedReportFiles?: Array< { name: string; from: string } >;
};

export type StaticSiteImporterPlugin = string | { path: string };

/** The import a create-from-source Blueprint carries, run once the importer is installed. */
export type StaticSiteImportPlan = {
	request: string;
	bundlePath?: string;
	sourcePath?: string;
	reportFiles?: Array< { name: string; from: string } >;
};

export type StaticSiteImportBlueprint = {
	contents: BlueprintV1Declaration;
	uri: string;
	staticSiteImport: StaticSiteImportPlan;
};

export function readSiteArtifact( artifactPath: string ): Record< string, unknown > {
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

export function isUrl( value: string ): boolean {
	return value.startsWith( 'http://' ) || value.startsWith( 'https://' );
}

function sourceFilePayload( filePath: string, relativePath: string ): Record< string, string > {
	return {
		path: relativePath.replace( /\\/g, '/' ),
		content_base64: fs.readFileSync( filePath ).toString( 'base64' ),
	};
}

function resolveDataLiberationWebsiteRoot( sourceDir: string ): string {
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

	const outputRoot = path.resolve( sourceDir );
	const websiteRoot = path.resolve( sourceDir, receipt.websiteRoot );
	const relativeRoot = path.relative( outputRoot, websiteRoot );
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

function isDataLiberationCaptureRoot( directory: string ): boolean {
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

function collectArtifactRootReports(
	sourcePath: string,
	websiteRoot: string
): Array< { name: string; from: string } > {
	// `--from <url>` stages `website/` (liberateWebsite's return value). Sidecars
	// live on the capture root, one directory up.
	for ( const candidateRoot of [ sourcePath, path.dirname( sourcePath ) ] ) {
		if (
			path.resolve( candidateRoot ) === path.resolve( websiteRoot ) ||
			! isDataLiberationCaptureRoot( candidateRoot )
		) {
			continue;
		}

		const files: Array< { name: string; from: string } > = [];
		for ( const name of ARTIFACT_ROOT_REPORT_FILES ) {
			const filePath = path.join( candidateRoot, name );
			if ( fs.existsSync( filePath ) && fs.statSync( filePath ).isFile() ) {
				files.push( { name, from: filePath } );
			}
		}
		return files;
	}

	return [];
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
				return {
					path: artifactPath,
					payload: { artifact },
				};
			}
		}

		const stagedSourcePath = resolveDataLiberationWebsiteRoot( sourcePath );
		if ( fs.readdirSync( stagedSourcePath ).length === 0 ) {
			throw new LoggerError( sprintf( __( 'Import source directory is empty: %s' ), sourcePath ) );
		}
		return {
			path: sourcePath,
			payload: {},
			stagedSourcePath,
			stagedReportFiles: collectArtifactRootReports( sourcePath, stagedSourcePath ),
		};
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
			path: sourcePath,
			payload: { artifact },
		};
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
		const reports = ( source.stagedReportFiles ?? [] ).map( ( file ) => file.name );
		requestSource = {
			type: 'files',
			ref: 'request-bundle:source',
			...( reports.length > 0 ? { metadata: { reports } } : {} ),
		};
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

export function capturedSourceTitle( websitePath: string ): string | undefined {
	const captureRoot = [ websitePath, path.dirname( websitePath ) ].find(
		isDataLiberationCaptureRoot
	);
	if ( ! captureRoot ) return undefined;
	const title = readSiteArtifact( path.join( captureRoot, 'capture-receipt.json' ) ).title;
	return typeof title === 'string' && title.trim() ? title.trim() : undefined;
}

/**
 * The site name for a `--from` source before it is prepared: an explicit name wins, then a local
 * source names itself when it is a titled artifact or a captured website. A URL is named from
 * its capture once liberated.
 */
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
		reportFiles: source.stagedReportFiles,
	} );
}

/** The blueprint that installs the importer, carrying the import it will run. */
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
		features: {
			networking: true,
		},
		steps: [
			{
				step: 'installPlugin',
				pluginData,
				options: {
					activate: true,
					targetFolderName: SSI_PLUGIN_SLUG,
				},
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
