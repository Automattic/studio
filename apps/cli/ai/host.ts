import path from 'path';
import { DEFAULT_PHP_VERSION } from '@studio/common/constants';
import { SITE_FILE_ACCESS_SITE_DIRECTORY } from '@studio/common/lib/site-file-access';
import { captureCommandOutput, captureConsoleOutput } from 'cli/ai/command-output';
import { getStudioUserAgent } from 'cli/ai/providers';
import { runCommand as runExportCommand } from 'cli/commands/export';
import { runCommand as runImportCommand } from 'cli/commands/import';
import { runCommand as runCreatePreviewCommand } from 'cli/commands/preview/create';
import {
	Mode as PreviewDeleteMode,
	runCommand as runDeletePreviewCommand,
} from 'cli/commands/preview/delete';
import { runCommand as runListPreviewCommand } from 'cli/commands/preview/list';
import { runCommand as runUpdatePreviewCommand } from 'cli/commands/preview/update';
import { runCommand as runPullCommand } from 'cli/commands/pull';
import { runCommand as runPushCommand } from 'cli/commands/push';
import { runCommand as runCreateSiteCommand } from 'cli/commands/site/create';
import { runCommand as runDeleteSiteCommand } from 'cli/commands/site/delete';
import { runCommand as runListSitesCommand } from 'cli/commands/site/list';
import { runCommand as runStartSiteCommand } from 'cli/commands/site/start';
import { runCommand as runStatusCommand } from 'cli/commands/site/status';
import { Mode as StopMode, runCommand as runStopSiteCommand } from 'cli/commands/site/stop';
import { getWpComSites } from 'cli/lib/api';
import { readCliConfig, type SiteData } from 'cli/lib/cli-config/core';
import { findSiteByFolder, getSiteByFolder, getSiteUrl } from 'cli/lib/cli-config/sites';
import { connectToDaemon, disconnectFromDaemon } from 'cli/lib/daemon-client';
import { runWpCliCommand } from 'cli/lib/run-wp-cli-command';
import { STUDIO_SITES_ROOT } from 'cli/lib/site-paths';
import { parseSyncOptions } from 'cli/lib/sync-api';
import { getTracksOrigin, recordTracksEvent } from 'cli/lib/tracks';
import { isServerRunning } from 'cli/lib/wordpress-server-manager';
import { Logger } from 'cli/logger';
import type { HostSite, StudioAgentHost } from '@studio/agent/node/host';

function toHostSite( site: SiteData ): HostSite {
	return {
		id: site.id,
		name: site.name,
		path: site.path,
		url: getSiteUrl( site ),
		phpVersion: site.phpVersion,
		adminPassword: site.adminPassword,
	};
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
		list: () => captureConsoleOutput( () => runListSitesCommand( 'json' ) ),
		status: ( site ) => captureConsoleOutput( () => runStatusCommand( site.path, 'json' ) ),
		create: ( name, sitePath, onProgress ) =>
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
			captureCommandOutput(
				( logger ) => runImportCommand( site.path, file, false, false, logger ),
				onProgress
			),
		export: ( site, file, mode, onProgress ) =>
			captureCommandOutput(
				( logger ) =>
					runExportCommand( site.path, file, mode, false, undefined, false, false, logger ),
				onProgress
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
	},
	previews: {
		list: ( site ) => captureConsoleOutput( () => runListPreviewCommand( site.path, 'json' ) ),
		create: ( site, onProgress ) =>
			captureCommandOutput(
				( logger ) => runCreatePreviewCommand( site.path, undefined, logger ),
				onProgress
			),
		update: ( site, hostname, overwrite, onProgress ) =>
			captureCommandOutput(
				( logger ) => runUpdatePreviewCommand( site.path, hostname, overwrite, logger ),
				onProgress
			),
		delete: ( hostname, onProgress ) =>
			captureCommandOutput(
				( logger ) =>
					runDeletePreviewCommand( PreviewDeleteMode.DELETE_SINGLE_SNAPSHOT, hostname, logger ),
				onProgress
			),
	},
	sync: {
		push: async ( site, options, remoteSite, onProgress ) => {
			const syncOptions = parseSyncOptions( options );
			return captureCommandOutput(
				( logger ) => runPushCommand( site.path, syncOptions, remoteSite, logger ),
				onProgress
			);
		},
		pull: async ( site, options, remoteSite, onProgress ) => {
			const syncOptions = parseSyncOptions( options );
			return captureCommandOutput(
				( logger ) => runPullCommand( site.path, syncOptions, remoteSite, undefined, logger ),
				onProgress
			);
		},
	},
	wpcom: {
		sites: ( accessToken ) => getWpComSites( accessToken ),
	},
	tracks: {
		record: ( event, props ) => recordTracksEvent( event, { ...getTracksOrigin(), ...props } ),
	},
};
