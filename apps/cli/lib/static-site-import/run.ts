import fs from 'fs';
import path from 'path';
import { SiteCommandLoggerAction as LoggerAction } from '@studio/common/logger-actions';
import { __, _n, sprintf } from '@wordpress/i18n';
import { SiteData } from 'cli/lib/cli-config/core';
import { getSiteUrl } from 'cli/lib/cli-config/sites';
import { runWpCliCommand, type RunWpCliCommandOptions } from 'cli/lib/run-wp-cli-command';
import { SSI_PLUGIN_SLUG, type StaticSiteImportPlan } from 'cli/lib/static-site-import/source';
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

function staticSiteImportResult(
	receipt: Record< string, unknown > | undefined
): Record< string, unknown > | undefined {
	const response = receipt?.response;
	if ( ! response || typeof response !== 'object' || Array.isArray( response ) ) {
		return undefined;
	}
	const result = ( response as Record< string, unknown > ).result;
	if ( result && typeof result === 'object' && ! Array.isArray( result ) ) {
		return result as Record< string, unknown >;
	}
	return response as Record< string, unknown >;
}

export function staticSiteImportQualityFailure(
	receipt: Record< string, unknown > | undefined
): string | undefined {
	const importResult = staticSiteImportResult( receipt );
	if ( ! importResult ) {
		return undefined;
	}
	const validation = importResult.import_validation_result;
	const summary = importResult.import_report_summary;
	const quality =
		validation && typeof validation === 'object' && ! Array.isArray( validation )
			? validation
			: summary && typeof summary === 'object' && ! Array.isArray( summary )
			? summary
			: undefined;
	if ( ! quality ) {
		return undefined;
	}
	const counts = ( quality as Record< string, unknown > ).counts;
	const {
		status,
		quality_pass: qualityPass,
		fail_import: failImport,
		fallback_count: fallbackCount,
		failure_reasons: failureReasons,
	} = quality as Record< string, unknown >;
	if ( status !== 'failed' && qualityPass !== false && failImport !== true ) {
		return undefined;
	}
	const failures = Array.isArray( failureReasons )
		? failureReasons.filter(
				( reason ): reason is string => typeof reason === 'string' && Boolean( reason )
		  )
		: [];
	const fallbackBlocks =
		counts && typeof counts === 'object' && ! Array.isArray( counts )
			? ( counts as Record< string, unknown > ).fallback_blocks
			: fallbackCount;
	const detail = failures.length
		? failures
				.map( ( reason ) => {
					const count = ( quality as Record< string, unknown > )[ `${ reason }_count` ];
					return typeof count === 'number'
						? sprintf(
								/* translators: 1: number of failures, 2: Static Site Importer failure reason */
								_n( 'SSI reported %1$d %2$s failure.', 'SSI reported %1$d %2$s failures.', count ),
								count,
								reason
						  )
						: sprintf(
								/* translators: %s: Static Site Importer failure reason */
								__( 'SSI reported a %s failure.' ),
								reason
						  );
				} )
				.join( ' ' )
		: typeof fallbackBlocks === 'number'
		? sprintf(
				/* translators: %d: number of fallback blocks */
				__( 'SSI reported %d fallback blocks.' ),
				fallbackBlocks
		  )
		: __( 'SSI rejected the imported content.' );
	return sprintf(
		/* translators: %s: Static Site Importer validation detail */
		__( '%s Review the importer diagnostics and retry.' ),
		detail
	);
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
		const { request, sourcePath, reportFiles = [] } = this.plan;
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
				} );
				for ( const { name, from } of reportFiles ) {
					await fs.promises.copyFile( from, path.join( stagedSource, name ) );
				}
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
		const qualityFailure = staticSiteImportQualityFailure( receipt );
		if ( qualityFailure ) {
			throw new LoggerError(
				__( 'Static site import failed quality validation' ),
				new Error( qualityFailure )
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
