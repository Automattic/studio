import fs from 'fs';
import path from 'path';
import { SiteCommandLoggerAction as LoggerAction } from '@studio/common/logger-actions';
import { __, sprintf } from '@wordpress/i18n';
import { SiteData } from 'cli/lib/cli-config/core';
import { getSiteUrl } from 'cli/lib/cli-config/sites';
import { runWpCliCommand, type RunWpCliCommandOptions } from 'cli/lib/run-wp-cli-command';
import {
	SSI_PLUGIN_SLUG,
	isDataLiberationCaptureRoot,
	type StaticSiteImportPlan,
} from 'cli/lib/static-site-import/source';
import { Logger, LoggerError } from 'cli/logger';

export const STATIC_SITE_IMPORT_PROGRESS_INTERVAL_MS = 30_000;
const STATIC_SITE_IMPORT_DIR = '.studio-import';
const STATIC_SITE_IMPORT_REQUEST = `${ STATIC_SITE_IMPORT_DIR }/request.json`;
const STATIC_SITE_IMPORT_RECEIPT_SCHEMA = 'static-site-importer/import-cli-receipt/v1';

type WpCliResult = { exitCode: number; stdout: string; stderr: string };

function staticSiteImportRequestPath( sitePath: string ): string {
	return path.join( sitePath, STATIC_SITE_IMPORT_REQUEST );
}

export function staticSiteImportSourcePath( sitePath: string ): string {
	return path.join( sitePath, STATIC_SITE_IMPORT_DIR, 'source' );
}

/**
 * The request of an unfinished import of `sourceUrl` staged in `sitePath`, if there is one.
 * Its staged source travels with it, so resuming needs neither the original capture nor a new one.
 */
export function stagedUrlImport( sitePath: string, sourceUrl: string ): string | undefined {
	try {
		const request = fs.readFileSync( staticSiteImportRequestPath( sitePath ), 'utf-8' );
		const staged = JSON.parse( request ) as { source_metadata?: { source_path?: unknown } };
		return staged.source_metadata?.source_path === sourceUrl &&
			fs.existsSync( staticSiteImportSourcePath( sitePath ) )
			? request
			: undefined;
	} catch {
		return undefined;
	}
}

export function decodeStaticSiteImportReceipt(
	output: string
): Record< string, unknown > | undefined {
	const lines = output.trim().split( /\r?\n/ );
	for ( let index = lines.length - 1; index >= 0; index-- ) {
		try {
			const receipt = JSON.parse( lines[ index ] );
			if ( receipt && typeof receipt === 'object' && ! Array.isArray( receipt ) ) {
				return receipt as Record< string, unknown >;
			}
		} catch {
			// WP-CLI may print informational lines before the terminal JSON receipt.
		}
	}
	return undefined;
}

export function staticSiteImportReceiptError(
	receipt: Record< string, unknown > | undefined
): string {
	const response = receipt?.response;
	if ( ! response || typeof response !== 'object' || Array.isArray( response ) ) {
		return '';
	}
	const error = ( response as Record< string, unknown > ).error;
	if ( ! error || typeof error !== 'object' || Array.isArray( error ) ) {
		return '';
	}
	const code = ( error as Record< string, unknown > ).code;
	const message = ( error as Record< string, unknown > ).message;
	const detail = [ code, message ]
		.filter( ( value ) => typeof value === 'string' && value )
		.join( ': ' );
	if ( code === 'static_site_importer_quality_failed' ) {
		return sprintf(
			/* translators: %s: Static Site Importer quality validation detail */
			__(
				'Static Site Importer materialized a preview but did not accept it. The site and staged request were preserved: %s'
			),
			detail || __( 'Quality validation failed.' )
		);
	}
	return detail;
}

// A capture root stages only what SSI reads from it: the receipt, the website root and the
// reports the receipt declares, leaving evidence trees such as `resources/` behind.
function captureStagingFilter( captureRoot: string ): ( source: string ) => boolean {
	const receipt = JSON.parse(
		fs.readFileSync( path.join( captureRoot, 'capture-receipt.json' ), 'utf-8' )
	) as { websiteRoot?: unknown; reports?: unknown };
	const kept = [
		'capture-receipt.json',
		receipt.websiteRoot,
		...( Array.isArray( receipt.reports ) ? receipt.reports : [] ),
	]
		.filter( ( entry ): entry is string => typeof entry === 'string' && Boolean( entry.trim() ) )
		.map( ( entry ) => path.normalize( entry ) )
		.filter( ( entry ) => entry !== '..' && ! entry.startsWith( `..${ path.sep }` ) );
	return ( source ) => {
		const relative = path.relative( captureRoot, source );
		return (
			! relative ||
			kept.some(
				( entry ) =>
					relative === entry ||
					relative.startsWith( `${ entry }${ path.sep }` ) ||
					entry.startsWith( `${ relative }${ path.sep }` )
			)
		);
	};
}

function staticSiteImportProgressMessage( phase: 'import' | 'finalization', elapsedMs: number ) {
	const elapsedSeconds = Math.floor( elapsedMs / 1000 );
	return phase === 'import'
		? sprintf( __( 'Static site import… %d sec elapsed' ), elapsedSeconds )
		: sprintf( __( 'Finalization… %d sec elapsed' ), elapsedSeconds );
}

async function runWpCli(
	site: SiteData,
	args: string[],
	options: RunWpCliCommandOptions = {}
): Promise< WpCliResult > {
	await using command = await runWpCliCommand( site, args, options );
	const [ exitCode, stdout, stderr ] = await Promise.all( [
		command.response.exitCode,
		command.response.stdoutText,
		command.response.stderrText,
	] );
	return { exitCode, stdout, stderr };
}

function wpCliFailureDetail( { exitCode, stdout, stderr }: WpCliResult ): string {
	return stderr.trim() || stdout.trim() || sprintf( __( 'WP-CLI exited with code %d.' ), exitCode );
}

async function cleanupStaticSiteImporterPlugin(
	site: SiteData,
	logger: Logger< LoggerAction >
): Promise< boolean > {
	try {
		// `is-installed` exits non-zero when the plugin is absent, which keeps cleanup
		// idempotent across a rerun that already removed it.
		const installed = await runWpCli( site, [ 'plugin', 'is-installed', SSI_PLUGIN_SLUG ] );
		if ( installed.exitCode !== 0 ) {
			return true;
		}

		for ( const command of [
			[ 'deactivate', SSI_PLUGIN_SLUG, '--quiet' ],
			[ 'delete', SSI_PLUGIN_SLUG ],
		] ) {
			const result = await runWpCli( site, [ 'plugin', ...command ] );
			if ( result.exitCode !== 0 ) {
				throw new Error( wpCliFailureDetail( result ) );
			}
		}
		return true;
	} catch ( error ) {
		logger.reportError(
			new LoggerError(
				__(
					'Static Site Importer cleanup failed. The imported site and staged request were preserved.'
				),
				error
			),
			false
		);
		return false;
	}
}

function reportRetainedImportedSite( site: SiteData ): void {
	console.log( '' );
	console.log(
		site.running
			? __( 'The site is running and can be inspected.' )
			: __( 'The imported site was kept and can be inspected.' )
	);
	console.log( sprintf( __( 'Path: %s' ), site.path ) );
	console.log( sprintf( __( 'URL: %s' ), getSiteUrl( site ) ) );
	console.log( __( 'Re-run the same command to resume the import.' ) );
	console.log( '' );
}

/**
 * One static import into the site at `sitePath`, tracking how far it got so a failure keeps
 * whatever the import touched (the site and its staged request) for a rerun.
 */
export class StaticSiteImportRun {
	// `attempted` means the site now holds real import state, so failure handling must
	// preserve it (and the staged request) for a rerun instead of tearing the site down.
	private outcome: 'not-attempted' | 'attempted' | 'succeeded' = 'not-attempted';
	// A site already registered at this path owns its own staged request; never clean it up.
	private siteAlreadyExisted = false;

	constructor(
		private readonly sitePath: string,
		private readonly plan: StaticSiteImportPlan,
		private readonly logger: Logger< LoggerAction >
	) {}

	/** Records the site already registered at the path, and whether its staged import is this one. */
	canResumeOn( existingSite: SiteData | undefined ): existingSite is SiteData {
		this.siteAlreadyExisted = Boolean( existingSite );
		const requestPath = staticSiteImportRequestPath( this.sitePath );
		return Boolean(
			existingSite &&
				fs.existsSync( requestPath ) &&
				( ! this.plan.sourcePath ||
					fs.existsSync( staticSiteImportSourcePath( this.sitePath ) ) ) &&
				fs.readFileSync( requestPath, 'utf-8' ) === this.plan.request
		);
	}

	async resume( site: SiteData ): Promise< void > {
		try {
			await this.run( site, true );
		} catch ( error ) {
			reportRetainedImportedSite( site );
			throw new LoggerError( __( 'Failed to import static site' ), error );
		}
	}

	async run( site: SiteData, resume = false ): Promise< void > {
		this.outcome = 'attempted';
		const { logger } = this;
		const { request, sourcePath } = this.plan;
		const requestPath = staticSiteImportRequestPath( site.path );
		// A resumed run already verified its staged request in `canResumeOn`.
		if ( ! resume ) {
			fs.mkdirSync( path.dirname( requestPath ), { recursive: true } );
			if ( sourcePath ) {
				const stagedSource = staticSiteImportSourcePath( site.path );
				await fs.promises.cp( sourcePath, stagedSource, {
					recursive: true,
					errorOnExist: true,
					force: false,
					...( isDataLiberationCaptureRoot( sourcePath )
						? { filter: captureStagingFilter( sourcePath ) }
						: {} ),
				} );
			}
			fs.writeFileSync( requestPath, request );
		}

		const startedAt = Date.now();
		logger.reportStart( LoggerAction.IMPORT_SITE, staticSiteImportProgressMessage( 'import', 0 ) );
		const progressTimer = setInterval( () => {
			logger.reportProgress( staticSiteImportProgressMessage( 'import', Date.now() - startedAt ) );
		}, STATIC_SITE_IMPORT_PROGRESS_INTERVAL_MS );
		progressTimer.unref?.();

		let result: WpCliResult;
		try {
			result = await runWpCli(
				site,
				[ 'static-site-importer', 'import', `--request=${ STATIC_SITE_IMPORT_REQUEST }` ],
				{ liveOutput: true, onLiveOutput: () => logger.spinner.stop() }
			);
		} finally {
			clearInterval( progressTimer );
		}

		logger.reportProgress( staticSiteImportProgressMessage( 'import', Date.now() - startedAt ) );
		const { exitCode, stdout } = result;
		const receipt = decodeStaticSiteImportReceipt( stdout );
		const receiptError = staticSiteImportReceiptError( receipt );
		if ( exitCode !== 0 ) {
			throw new LoggerError(
				__( 'Static site import failed.' ),
				new Error( receiptError || wpCliFailureDetail( result ) )
			);
		}
		if ( receipt?.schema !== STATIC_SITE_IMPORT_RECEIPT_SCHEMA || receipt.status !== 'completed' ) {
			throw new LoggerError(
				__( 'Static site import returned an invalid terminal receipt.' ),
				new Error( receiptError || stdout.trim() || __( 'The importer did not return a receipt.' ) )
			);
		}
		const finalizationStartedAt = Date.now();
		logger.reportProgress( staticSiteImportProgressMessage( 'finalization', 0 ) );
		const cleanupSucceeded = await cleanupStaticSiteImporterPlugin( site, logger );
		logger.reportProgress(
			staticSiteImportProgressMessage( 'finalization', Date.now() - finalizationStartedAt )
		);
		logger.reportSuccess( __( 'Static site imported successfully' ) );
		this.outcome = cleanupSucceeded ? 'succeeded' : 'attempted';
	}

	/** After a failure, reports the site as kept for a rerun when the import already touched it. */
	retainSiteAfterFailure( site: SiteData ): boolean {
		if ( this.outcome === 'not-attempted' ) {
			return false;
		}
		reportRetainedImportedSite( site );
		return true;
	}

	/** Removes the staged request unless it is resumable: the import ran but did not finish. */
	finish(): void {
		if (
			this.outcome === 'succeeded' ||
			( this.outcome === 'not-attempted' && ! this.siteAlreadyExisted )
		) {
			fs.rmSync( path.join( this.sitePath, STATIC_SITE_IMPORT_DIR ), {
				recursive: true,
				force: true,
			} );
		}
	}
}
