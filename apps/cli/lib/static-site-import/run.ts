import fs from 'fs';
import path from 'path';
import { SiteCommandLoggerAction as LoggerAction } from '@studio/common/logger-actions';
import { __, sprintf } from '@wordpress/i18n';
import { SiteData } from 'cli/lib/cli-config/core';
import { getSiteUrl } from 'cli/lib/cli-config/sites';
import { runWpCliCommand, type RunWpCliCommandOptions } from 'cli/lib/run-wp-cli-command';
import {
	SSI_PLUGIN_SLUG,
	STATIC_SITE_IMPORT_PROGRESS_INTERVAL_MS,
} from 'cli/lib/static-site-import/constants';
import {
	decodeStaticSiteImportReceipt,
	STATIC_SITE_IMPORT_RECEIPT_SCHEMA,
	staticSiteImportQualityFailure,
	staticSiteImportReceiptError,
} from 'cli/lib/static-site-import/receipt';
import {
	removeStagedStaticSiteImport,
	STATIC_SITE_IMPORT_DIR,
	STATIC_SITE_IMPORT_REQUEST_FILE,
	staticSiteImportRequestPath,
	staticSiteImportSourcePath,
} from 'cli/lib/static-site-import/staging';
import { Logger, LoggerError } from 'cli/logger';
import type { StaticSiteImportPlan } from 'cli/lib/static-site-import/source';

type StaticSiteImportProgressPhase = 'import' | 'finalization';

type WpCliResult = { exitCode: number; stdout: string; stderr: string };

export function staticSiteImportProgressMessage(
	phase: StaticSiteImportProgressPhase,
	elapsedMs: number
): string {
	const elapsedSeconds = Math.floor( elapsedMs / 1000 );
	if ( phase === 'import' ) {
		return sprintf( __( 'Static site import… %d sec elapsed' ), elapsedSeconds );
	}
	return sprintf( __( 'Finalization… %d sec elapsed' ), elapsedSeconds );
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

async function runStaticSiteImport(
	site: SiteData,
	plan: StaticSiteImportPlan,
	resume: boolean,
	logger: Logger< LoggerAction >
): Promise< boolean > {
	const { request, sourcePath, reportFiles = [] } = plan;
	const requestPath = staticSiteImportRequestPath( site.path );
	if ( resume ) {
		if ( ! fs.existsSync( requestPath ) || fs.readFileSync( requestPath, 'utf-8' ) !== request ) {
			throw new LoggerError( __( 'The staged static site import request does not match.' ) );
		}
	} else {
		fs.mkdirSync( path.dirname( requestPath ), { recursive: true } );
		if ( sourcePath ) {
			await fs.promises.cp( sourcePath, staticSiteImportSourcePath( site.path ), {
				recursive: true,
				errorOnExist: true,
				force: false,
			} );
			for ( const report of reportFiles ) {
				await fs.promises.copyFile(
					report.from,
					path.join( staticSiteImportSourcePath( site.path ), report.name )
				);
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
			[
				'static-site-importer',
				'import',
				`--request=${ path.posix.join( STATIC_SITE_IMPORT_DIR, STATIC_SITE_IMPORT_REQUEST_FILE ) }`,
			],
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
	return cleanupSucceeded;
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

		const deactivated = await runWpCli( site, [
			'plugin',
			'deactivate',
			SSI_PLUGIN_SLUG,
			'--quiet',
		] );
		if ( deactivated.exitCode !== 0 ) {
			throw new Error( wpCliFailureDetail( deactivated ) );
		}

		const deleted = await runWpCli( site, [ 'plugin', 'delete', SSI_PLUGIN_SLUG ] );
		if ( deleted.exitCode !== 0 ) {
			throw new Error( wpCliFailureDetail( deleted ) );
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
	const siteUrl = getSiteUrl( site );
	console.log( '' );
	console.log(
		site.running
			? __( 'The site is running and can be inspected.' )
			: __( 'The imported site was kept and can be inspected.' )
	);
	console.log( sprintf( __( 'Path: %s' ), site.path ) );
	console.log( sprintf( __( 'URL: %s' ), siteUrl ) );
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
		const cleanupSucceeded = await runStaticSiteImport( site, this.plan, resume, this.logger );
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
			removeStagedStaticSiteImport( this.sitePath );
		}
	}
}
