import fs from 'fs';
import nodePath from 'path';
import * as Sentry from '@sentry/electron/main';
import { parseJsonFromPhpOutput } from '@studio/common/lib/php-output-parser';
import {
	listSitesWithMetadata,
	readSiteMetadata,
	themeDetailsSchema,
	updateSiteMetadata,
	type SiteMetadata,
} from '@studio/common/sites/metadata';
import { z } from 'zod';
import {
	WP_CLI_DEFAULT_RESPONSE_TIMEOUT,
	WP_CLI_IMPORT_EXPORT_RESPONSE_TIMEOUT,
} from 'src/constants';
import { isInErrorRecovery } from 'src/lib/php-error-recovery';
import { executeCliCommand } from 'src/modules/cli/lib/execute-command';
import { getSiteThumbnailPath } from 'src/storage/paths';
import type { SiteListItem } from '@studio/common/lib/cli-events';

export type WpCliResult = { stdout: string; stderr: string; exitCode: number };

type SiteRef = { id: string; path: string };

export type Site = SiteListItem & SiteMetadata;

/** The user's sites as the CLI reports them, with Studio's own metadata merged in. */
export async function getSites(): Promise< Site[] > {
	const sites = await listSitesWithMetadata( executeCliCommand );
	// A site serving a PHP-error page counts as running even though the CLI reports it stopped.
	return sites.map( ( site ) =>
		isInErrorRecovery( site.id )
			? { ...site, running: true, url: `http://localhost:${ site.port }` }
			: site
	);
}

export async function getSite( id: string ): Promise< Site | undefined > {
	return ( await getSites() ).find( ( site ) => site.id === id );
}

/** Drop the Studio-owned data of a site the CLI no longer knows. */
export async function forgetSite( id: string ): Promise< void > {
	await fs.promises.rm( getSiteThumbnailPath( id ), { force: true } );
	await updateSiteMetadata( { [ id ]: null } );
}

/**
 * Stop all running sites using the CLI `site stop --all` command.
 *
 * @param timeoutAfterMs Optional timeout in milliseconds.
 */
export async function stopAllServers( timeoutAfterMs?: number ) {
	let timeoutId: NodeJS.Timeout | undefined;

	return new Promise< void >( ( resolve ) => {
		const args = [ 'site', 'stop', '--all' ];
		const [ emitter, childProcess ] = executeCliCommand( args, { output: 'ignore' } );
		emitter.on( 'success', () => resolve() );
		emitter.on( 'failure', () => resolve() );
		emitter.on( 'error', () => resolve() );

		if ( timeoutAfterMs ) {
			timeoutId = setTimeout( () => {
				console.warn(
					`site stop --all command timed out after ${ timeoutAfterMs }ms. Killing process.`
				);
				childProcess.kill( 'SIGKILL' );
				resolve();
			}, timeoutAfterMs );
		}
	} ).finally( () => {
		if ( timeoutId ) {
			clearTimeout( timeoutId );
		}
	} );
}

export async function executeWpCliCommand(
	site: SiteRef,
	wpCliArgs: string[],
	{ skipPluginsAndThemes = false }: { skipPluginsAndThemes?: boolean } = {}
): Promise< WpCliResult > {
	const cliArgs = [ 'wp', '--path', site.path, ...wpCliArgs ];
	if ( skipPluginsAndThemes ) {
		cliArgs.push( '--skip-plugins', '--skip-themes' );
	}

	const isImportExport =
		wpCliArgs[ 0 ] === 'sqlite' && [ 'import', 'export' ].includes( wpCliArgs[ 1 ] );
	const timeout = isImportExport
		? WP_CLI_IMPORT_EXPORT_RESPONSE_TIMEOUT
		: WP_CLI_DEFAULT_RESPONSE_TIMEOUT;

	let timeoutId: NodeJS.Timeout;

	return new Promise< WpCliResult >( ( resolve ) => {
		const [ emitter, childProcess ] = executeCliCommand( cliArgs, {
			output: 'capture',
			logPrefix: site.id,
			// Returned to the caller as part of `WpCliResult`, which callers log themselves.
			suppressStderrEcho: true,
		} );

		timeoutId = setTimeout( () => {
			childProcess.kill();
			resolve( {
				stdout: '',
				stderr: `WP-CLI command timed out after ${ timeout }ms`,
				exitCode: 1,
			} );
		}, timeout );

		emitter.on( 'success', ( { result } ) => {
			resolve( { stdout: result.stdout, stderr: result.stderr, exitCode: 0 } );
		} );

		emitter.on( 'failure', ( { error, result } ) => {
			resolve( {
				stdout: result.stdout,
				stderr: result.stderr || error.lastErrorMessage || '',
				exitCode: 1,
			} );
		} );

		emitter.on( 'error', ( { error } ) => {
			Sentry.captureException( error );
			resolve( {
				stdout: '',
				stderr: `Error executing WP-CLI command: ${ error.message }`,
				exitCode: 1,
			} );
		} );
	} ).finally( () => {
		clearTimeout( timeoutId );
	} );
}

/** Read a running site's active theme, persisting it when it changed. */
export async function refreshThemeDetails(
	site: SiteRef
): Promise< SiteDetails[ 'themeDetails' ] > {
	const stored = ( await readSiteMetadata() )[ site.id ]?.themeDetails;
	try {
		const { stdout, stderr, exitCode } = await executeWpCliCommand( site, [
			'studio',
			'get-theme-details',
		] );
		if ( exitCode !== 0 || ! stdout ) {
			console.error( 'Failed to get theme details via WP-CLI', { exitCode, stdout, stderr } );
			return stored;
		}

		const themeDetails = themeDetailsSchema.parse( parseJsonFromPhpOutput( stdout ) );
		if ( themeDetails.path !== stored?.path ) {
			await updateSiteMetadata( { [ site.id ]: { themeDetails } } );
		}
		return themeDetails;
	} catch ( error ) {
		console.error( 'Failed to get theme details:', error );
		return stored;
	}
}

const siteIconSchema = z.object( { relativePath: z.string() } ).nullable();

/** Read a running site's icon path, persisting it when it changed. */
export async function refreshSiteIcon( site: SiteRef ): Promise< void > {
	try {
		const { stdout, stderr, exitCode } = await executeWpCliCommand( site, [
			'studio',
			'get-site-icon',
		] );
		if ( exitCode !== 0 ) {
			console.error( 'Failed to get site icon via WP-CLI', { exitCode, stdout, stderr } );
			return;
		}

		const icon = siteIconSchema.parse( parseJsonFromPhpOutput( stdout ) );
		const siteIconPath = icon && nodePath.join( site.path, icon.relativePath );
		if ( siteIconPath !== ( await readSiteMetadata() )[ site.id ]?.siteIconPath ) {
			await updateSiteMetadata( { [ site.id ]: { siteIconPath } } );
		}
	} catch ( error ) {
		console.error( 'Failed to get site icon:', error );
	}
}
