import fs from 'fs';
import path from 'path';
import { removeBlueprintTempDir } from '@studio/common/lib/blueprint-bundle';
import { SiteCommandLoggerAction as LoggerAction } from '@studio/common/logger-actions';
import { __, sprintf } from '@wordpress/i18n';
import { readCliConfig } from 'cli/lib/cli-config/core';
import { getSiteUrl } from 'cli/lib/cli-config/sites';
import {
	captureCompareCommand,
	captureRootFor,
	liberateWebsite,
	type PartialCaptureReport,
} from 'cli/lib/data-liberation-client';
import { resolveStaticSiteImporterPlugin } from 'cli/lib/import-runtime';
import { isSqliteIntegrationAvailable } from 'cli/lib/sqlite-integration';
import {
	STATIC_SITE_IMPORT_PROGRESS_INTERVAL_MS,
	stagedUrlImport,
	staticSiteImportSourcePath,
} from 'cli/lib/static-site-import/run';
import {
	artifactTitle,
	buildCreateFromSourceBlueprint,
	capturedSourceTitle,
	importerBlueprint,
	isUrl,
	type StaticSiteImportBlueprint,
	type StaticSiteImporterPlugin,
	type StaticSiteImportPlan,
} from 'cli/lib/static-site-import/source';
import { Logger, LoggerError } from 'cli/logger';

const PARTIAL_CAPTURE_REPORTED_ROUTES = 10;

export type PreparedSourceImport = {
	blueprint: StaticSiteImportBlueprint;
	liberationOutputDir?: string;
	compareCommand?: ( siteUrl: string ) => string;
	capturedPartially: boolean;
	siteName: string;
};

// A partial capture still imports, so the routes it dropped have to stay discoverable after
// the terminal output is gone: the message names each one, and the caller keeps the capture
// directory the diagnostics live in instead of deleting it with the rest of the source.
function partialCaptureWarning( report: PartialCaptureReport ): string {
	const lines = [
		sprintf(
			/* translators: 1: dropped route count, 2: discovered route count */
			__(
				'Data Liberation could not capture %1$d of %2$d routes. They are missing from the imported site:'
			),
			report.droppedRoutes.length,
			report.routesDiscovered
		),
		...report.droppedRoutes
			.slice( 0, PARTIAL_CAPTURE_REPORTED_ROUTES )
			.map( ( route ) => `  - ${ route.url }: ${ route.reason }` ),
	];
	const unlisted = report.droppedRoutes.length - PARTIAL_CAPTURE_REPORTED_ROUTES;
	if ( unlisted > 0 ) {
		/* translators: %d: number of failed routes not listed individually */
		lines.push( sprintf( __( '  …and %d more.' ), unlisted ) );
	}
	lines.push(
		sprintf(
			/* translators: %s: path to the retained capture diagnostics file */
			__( 'The capture was kept for review: %s' ),
			report.diagnosticsPath
		)
	);
	return lines.join( '\n' );
}

/**
 * Turn a `--from` source into the blueprint that imports it. A URL is first captured with the
 * newest Data Liberation release into the sibling `<site>-source` directory; every source is
 * then imported with the newest Static Site Importer release unless an importer is given.
 */
export async function prepareSourceImport(
	source: string,
	sitePath: string,
	siteName: string | undefined,
	logger: Logger< LoggerAction >,
	options: {
		staticSiteImporter?: StaticSiteImporterPlugin;
		liberate?: typeof liberateWebsite;
	} = {}
): Promise< PreparedSourceImport > {
	const sourceUrl = isUrl( source ) ? source : undefined;
	const captureDir = path.join( path.dirname( sitePath ), `${ path.basename( sitePath ) }-source` );
	const resumable = sourceUrl ? stagedUrlImport( sitePath, sourceUrl ) : undefined;
	if ( sourceUrl && resumable ) {
		// Re-running the command after a failed import resumes it. The staged request already
		// names its capture, so the source is not captured again.
		logger.reportSuccess( __( 'Resuming the staged import; the source is not captured again' ) );
		const blueprint = importerBlueprint(
			options.staticSiteImporter ?? { path: ( await resolveStaticSiteImporterPlugin() ).path },
			{ request: resumable, sourcePath: staticSiteImportSourcePath( sitePath ) }
		);
		const keptCapture = captureRootFor( sourceUrl, captureDir );
		return {
			blueprint,
			siteName: siteName ?? artifactTitle( JSON.parse( resumable ) ) ?? __( 'Imported Site' ),
			compareCommand: fs.existsSync( keptCapture )
				? await captureCompareCommand( keptCapture ).catch( () => undefined )
				: undefined,
			capturedPartially: false,
		};
	}
	let liberated: Awaited< ReturnType< typeof liberateWebsite > > | undefined;
	if ( sourceUrl ) {
		if ( ! ( await isSqliteIntegrationAvailable() ) ) {
			throw new LoggerError(
				__(
					'Cannot set up WordPress. Bundled SQLite integration files not found. Please reinstall Studio.'
				)
			);
		}
		let lastProgressAt = 0;
		logger.reportStart(
			LoggerAction.IMPORT_SITE,
			__( 'Preparing source website with Data Liberation…' )
		);
		liberated = await ( options.liberate ?? liberateWebsite )( sourceUrl, captureDir, {
			onProgress: ( message ) => {
				const now = Date.now();
				if ( now - lastProgressAt >= STATIC_SITE_IMPORT_PROGRESS_INTERVAL_MS ) {
					lastProgressAt = now;
					logger.reportProgress( message );
				}
			},
		} );
		if ( liberated.partialCapture ) {
			logger.reportWarning( partialCaptureWarning( liberated.partialCapture ) );
		}
		logger.reportSuccess( __( 'Source website prepared' ) );
	}
	const importSource = liberated?.websiteDir ?? source;
	const resolvedSiteName = siteName ?? capturedSourceTitle( importSource ) ?? __( 'Imported Site' );
	const blueprint = buildCreateFromSourceBlueprint(
		importSource,
		resolvedSiteName,
		options.staticSiteImporter ?? { path: ( await resolveStaticSiteImporterPlugin() ).path },
		sourceUrl
	);
	return {
		blueprint,
		liberationOutputDir: sourceUrl ? captureDir : undefined,
		compareCommand: liberated?.compareCommand,
		capturedPartially: Boolean( liberated?.partialCapture ),
		siteName: resolvedSiteName,
	};
}

export async function completeSourceImport(
	prepared: PreparedSourceImport,
	sitePath: string,
	{ keepSource }: { keepSource: boolean }
): Promise< void > {
	if ( prepared.liberationOutputDir && ! keepSource && ! prepared.capturedPartially ) {
		await fs.promises
			.rm( prepared.liberationOutputDir, { recursive: true, force: true } )
			.catch( () => {} );
	} else if ( prepared.compareCommand ) {
		const site = ( await readCliConfig() ).sites.find(
			( candidate ) => candidate.path === sitePath
		);
		if ( site ) {
			console.log(
				sprintf(
					/* translators: %s: command that compares the new site with the original site */
					__( 'Compare the new site with the original, page by page:\n  %s' ),
					prepared.compareCommand( getSiteUrl( site ) )
				)
			);
		}
	}
}

export async function removeStaticSiteImportBundle( plan?: StaticSiteImportPlan ): Promise< void > {
	if ( plan?.bundlePath ) {
		await removeBlueprintTempDir( plan.bundlePath ).catch( () => {} );
	}
}
