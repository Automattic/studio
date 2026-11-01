import path from 'path';
import { DEFAULT_PHP_VERSION } from '@studio/common/constants';
import { readAuthToken } from '@studio/common/lib/shared-config';
import { SITE_FILE_ACCESS_SITE_DIRECTORY } from '@studio/common/lib/site-file-access';
import { __ } from '@wordpress/i18n';
import { getStudioUserAgent } from 'cli/ai/providers';
import { runCommand as runExportCommand } from 'cli/commands/export';
import { runCommand as runImportCommand } from 'cli/commands/import';
import { runCommand as runCreatePreviewCommand } from 'cli/commands/preview/create';
import {
	Mode as PreviewDeleteMode,
	runCommand as runDeletePreviewCommand,
} from 'cli/commands/preview/delete';
import { runCommand as runUpdatePreviewCommand } from 'cli/commands/preview/update';
import { runCommand as runPullCommand } from 'cli/commands/pull';
import { runCommand as runPushCommand } from 'cli/commands/push';
import { runCommand as runCreateSiteCommand } from 'cli/commands/site/create';
import { runCommand as runDeleteSiteCommand } from 'cli/commands/site/delete';
import { listSites } from 'cli/commands/site/list';
import { runCommand as runStartSiteCommand } from 'cli/commands/site/start';
import { getSiteStatus } from 'cli/commands/site/status';
import { Mode as StopMode, runCommand as runStopSiteCommand } from 'cli/commands/site/stop';
import { getWpComSites } from 'cli/lib/api';
import { readCliConfig, type SiteData } from 'cli/lib/cli-config/core';
import { findSiteByFolder, getSiteByFolder, getSiteUrl } from 'cli/lib/cli-config/sites';
import { connectToDaemon, disconnectFromDaemon } from 'cli/lib/daemon-client';
import {
	readFrontendLogTail,
	startFrontendServer,
	stopFrontendServer,
	type HeadlessSite,
} from 'cli/lib/frontend/server';
import { runWpCliCommand } from 'cli/lib/run-wp-cli-command';
import { STUDIO_SITES_ROOT } from 'cli/lib/site-paths';
import { getSnapshotsFromConfig } from 'cli/lib/snapshots';
import { parseSyncOptions } from 'cli/lib/sync-api';
import { getTracksOrigin, recordTracksEvent } from 'cli/lib/tracks';
import { isServerRunning } from 'cli/lib/wordpress-server-manager';
import { Logger, LoggerError } from 'cli/logger';
import type { HostSite, StudioAgentHost } from '@studio/agent/node';

function toHostSite( site: SiteData ): HostSite {
	return {
		id: site.id,
		name: site.name,
		path: site.path,
		url: getSiteUrl( site ),
		phpVersion: site.phpVersion,
		adminPassword: site.adminPassword,
		frontend: site.frontend,
	};
}

async function getHeadlessSiteByFolder( sitePath: string ): Promise< HeadlessSite > {
	const site = await getSiteByFolder( sitePath );
	if ( ! site.frontend ) {
		throw new LoggerError( `"${ site.name }" is not a headless site.` );
	}
	return site as HeadlessSite;
}

async function findSiteByName( name: string ): Promise< SiteData | undefined > {
	const config = await readCliConfig();
	const sites = config.sites.filter( ( site ) => site.name.toLowerCase() === name.toLowerCase() );
	if ( sites.length > 1 ) {
		const paths = sites.map( ( site ) => site.path ).join( ', ' );
		throw new Error(
			`${ sites.length } sites are named "${ name }". Pass the full path of the one you mean: ${ paths }`
		);
	}
	return sites[ 0 ];
}

async function resolveSite( nameOrPath: string ): Promise< SiteData > {
	const siteByName = await findSiteByName( nameOrPath );
	if ( siteByName ) {
		return siteByName;
	}

	// Also try matching by the last folder segment of the site path,
	// since the agent may pass just the folder name instead of the full path.
	if ( ! path.isAbsolute( nameOrPath ) ) {
		const config = await readCliConfig();
		const siteByFolder = config.sites.find( ( site ) => path.basename( site.path ) === nameOrPath );
		if ( siteByFolder ) {
			return siteByFolder;
		}
	}

	return getSiteByFolder( nameOrPath );
}

async function withDaemon< T >( fn: () => Promise< T > ): Promise< T > {
	await connectToDaemon();
	try {
		return await fn();
	} finally {
		await disconnectFromDaemon();
	}
}

export const cliAgentHost: StudioAgentHost = {
	sitesRoot: STUDIO_SITES_ROOT,
	get userAgent() {
		return getStudioUserAgent();
	},
	sites: {
		resolve: async ( nameOrPath ) => toHostSite( await resolveSite( nameOrPath ) ),
		findByFolder: async ( folder ) => {
			const site = await findSiteByFolder( folder );
			return site && toHostSite( site );
		},
		all: async () => ( await readCliConfig() ).sites.map( toHostSite ),
		list: () => listSites(),
		status: ( site ) =>
			withDaemon( async () => getSiteStatus( await getSiteByFolder( site.path ) ) ),
		create: ( name, sitePath, onProgress, options ) =>
			runCreateSiteCommand(
				sitePath,
				{
					name,
					wpVersion: 'latest',
					phpVersion: DEFAULT_PHP_VERSION,
					fileAccess: SITE_FILE_ACCESS_SITE_DIRECTORY,
					enableHttps: false,
					noStart: false,
					skipBrowser: true,
					skipLogDetails: true,
					frontend: options?.frontend,
				},
				new Logger( { onProgress } )
			),
		start: ( site, onProgress ) =>
			runStartSiteCommand( site.path, true, true, new Logger( { onProgress } ) ),
		stop: ( site, onProgress ) =>
			runStopSiteCommand( StopMode.STOP_SINGLE_SITE, site.path, new Logger( { onProgress } ) ),
		delete: ( site, deleteFiles, onProgress ) =>
			runDeleteSiteCommand( site.path, deleteFiles, new Logger( { onProgress } ) ),
		isRunning: ( site ) => withDaemon( async () => Boolean( await isServerRunning( site.id ) ) ),
		import: ( site, file, onProgress ) =>
			runImportCommand( site.path, file, false, false, new Logger( { onProgress } ) ),
		export: ( site, file, mode, onProgress ) =>
			runExportCommand(
				site.path,
				file,
				mode,
				false,
				undefined,
				false,
				false,
				new Logger( { onProgress } )
			),
		wpCli: ( site, args ) =>
			withDaemon( async () => {
				await using command = await runWpCliCommand( await getSiteByFolder( site.path ), args );
				return {
					exitCode: await command.response.exitCode,
					stdout: await command.response.stdoutText,
					stderr: await command.response.stderrText,
				};
			} ),
		frontendRestart: ( site, onProgress ) =>
			withDaemon( async () => {
				const headlessSite = await getHeadlessSiteByFolder( site.path );
				await stopFrontendServer( headlessSite.id );
				await startFrontendServer( headlessSite, new Logger( { onProgress } ) );
			} ),
		frontendLogs: async ( site, lines ) =>
			readFrontendLogTail( ( await getHeadlessSiteByFolder( site.path ) ).id, lines ).join( '\n' ),
	},
	previews: {
		// The site's own previews; `preview list --format json` lists every site's.
		list: async ( site ) => {
			const token = await readAuthToken();
			if ( ! token ) {
				throw new LoggerError(
					__( 'Authentication required. Please log in with `studio auth login`.' )
				);
			}
			return getSnapshotsFromConfig( token.id, site.path );
		},
		create: ( site, onProgress ) =>
			runCreatePreviewCommand( site.path, undefined, new Logger( { onProgress } ) ),
		update: ( site, hostname, overwrite, onProgress ) =>
			runUpdatePreviewCommand( site.path, hostname, overwrite, new Logger( { onProgress } ) ),
		delete: ( hostname, onProgress ) =>
			runDeletePreviewCommand(
				PreviewDeleteMode.DELETE_SINGLE_SNAPSHOT,
				hostname,
				new Logger( { onProgress } )
			),
	},
	sync: {
		push: async ( site, options, remoteSite, onProgress ) =>
			runPushCommand(
				site.path,
				parseSyncOptions( options ),
				remoteSite,
				new Logger( { onProgress } )
			),
		pull: async ( site, options, remoteSite, onProgress ) =>
			runPullCommand(
				site.path,
				parseSyncOptions( options ),
				remoteSite,
				undefined,
				new Logger( { onProgress } )
			),
	},
	wpcom: {
		sites: ( accessToken ) => getWpComSites( accessToken ),
	},
	tracks: {
		record: ( event, props ) => recordTracksEvent( event, { ...getTracksOrigin(), ...props } ),
	},
};
