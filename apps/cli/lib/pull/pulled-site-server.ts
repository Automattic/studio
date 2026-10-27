import fs from 'fs';
import path from 'path';
import { __, sprintf } from '@wordpress/i18n';
import {
	getSetAdminCredentialsRequestBody,
	shouldSetAdminCredentials,
	toUrlSearchParams,
} from 'cli/lib/admin-credentials';
import { type SiteData } from 'cli/lib/cli-config/core';
import { getSiteUrl, updateSiteLatestCliPid } from 'cli/lib/cli-config/sites';
import { connectToDaemon, disconnectFromDaemon, isProcessRunning } from 'cli/lib/daemon-client';
import { type PullSession } from 'cli/lib/pull/pull-session';
import {
	getProcessName,
	startWordPressServer,
	stopWordPressServer,
	type StartServerOptions,
} from 'cli/lib/wordpress-server-manager';
import { Logger, LoggerError } from 'cli/logger';

/**
 * Prepends Reprint's `runtime.php`, which sets up the pulled database, and
 * gives PHP access to the pull's files. Returns undefined for sites that
 * weren't pulled or have no `runtime.php`.
 */
export function getPulledSiteStartOptions( site: {
	technicalSiteDirectory?: string;
	runtimeBlueprintPath?: string;
} ): StartServerOptions | undefined {
	if ( ! site.runtimeBlueprintPath ) {
		return undefined;
	}
	const runtimePhpPath = path.join( path.dirname( site.runtimeBlueprintPath ), 'runtime.php' );
	if ( ! fs.existsSync( runtimePhpPath ) ) {
		return undefined;
	}

	return {
		autoPrependFile: runtimePhpPath,
		openBasedirAllowList: site.technicalSiteDirectory ? [ site.technicalSiteDirectory ] : [],
	};
}

/**
 * Saves the pulled site's start options to `start-options.json`, where
 * `studio site start` and the daemon read them, and returns them.
 */
export function savePulledSiteStartOptions( session: PullSession ): StartServerOptions {
	const startOptions = getPulledSiteStartOptions( session );
	if ( ! startOptions ) {
		throw new LoggerError(
			`Missing runtime.php in ${ session.runtimeDirectory }. Re-run \`studio pull-reprint\` to regenerate the runtime configuration.`
		);
	}
	fs.writeFileSync(
		path.join( session.runtimeDirectory, 'start-options.json' ),
		JSON.stringify( startOptions, null, 2 ) + '\n'
	);
	return startOptions;
}

/**
 * Serves the pulled site. `restart` reloads a server still running the blank
 * install's runtime; otherwise a running server keeps serving, since PHP
 * reads the pulled files on every request.
 */
export async function startPulledSite(
	site: SiteData,
	logger: Logger< string >,
	runtimeStartOptions: StartServerOptions,
	{ restart }: { restart: boolean }
): Promise< void > {
	try {
		await connectToDaemon();

		const runningProcess = await isProcessRunning( getProcessName( site.id ) );

		if ( restart ) {
			if ( runningProcess ) {
				await stopWordPressServer( site.id );
			}
			await startWordPressServer( site, logger, runtimeStartOptions );
			logger.reportSuccess( __( 'WordPress server restarted' ) );
			return;
		}

		// The pulled database replaced the local admin user, which a start would
		// recreate. An unreachable server is started instead.
		const credentialsResult = runningProcess
			? await reapplyAdminCredentials( site )
			: 'unreachable';
		if ( runningProcess && credentialsResult !== 'unreachable' ) {
			logger.reportSuccess( __( 'WordPress server already running' ) );
			// As `studio site start` does for a running site.
			if ( runningProcess.status === 'online' ) {
				await updateSiteLatestCliPid( site.id, runningProcess.pid );
			}
		} else {
			await startWordPressServer( site, logger, runtimeStartOptions );
			logger.reportSuccess( __( 'WordPress server started' ) );
		}
	} catch ( serverError ) {
		throw new LoggerError(
			__( 'Failed to start the WordPress server for the pulled site.' ),
			serverError
		);
	} finally {
		await disconnectFromDaemon();
	}
}

/**
 * Recreates the local admin user on a running site, which auto-login needs
 * after the pulled database replaced it. Returns 'skipped' when the site has
 * no stored credentials, and 'unreachable' when the server doesn't answer.
 */
export async function reapplyAdminCredentials(
	site: SiteData
): Promise< 'applied' | 'skipped' | 'unreachable' > {
	const credentials = {
		adminUsername: site.adminUsername,
		adminPassword: site.adminPassword,
		adminEmail: site.adminEmail,
	};
	if ( ! shouldSetAdminCredentials( credentials ) ) {
		return 'skipped';
	}

	let response: Response;
	try {
		response = await fetch( new URL( '/?studio-admin-api', getSiteUrl( site ) ), {
			method: 'POST',
			body: toUrlSearchParams( getSetAdminCredentialsRequestBody( credentials ) ),
			signal: AbortSignal.timeout( 15_000 ),
		} );
	} catch {
		return 'unreachable';
	}

	if ( ! response.ok ) {
		throw new LoggerError(
			sprintf(
				// translators: %d: HTTP status code.
				__( 'Failed to re-apply the admin credentials after the database refresh (HTTP %d).' ),
				response.status
			)
		);
	}

	return 'applied';
}
