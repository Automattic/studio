import path from 'path';
import { cliAgentHost } from 'cli/ai/host';
import { runWpCliCommand } from 'cli/lib/run-wp-cli-command';
import type { HostSite, StudioAgentHost } from '@studio/agent/node';
import type { SiteData } from 'cli/lib/cli-config/core';

// A WordPress install a test made, as the site of the CLI's own host: WP-CLI
// runs on it as it does on a registered site.
export function liveSite( root: string, name = 'Live Site', id = path.basename( root ) ): HostSite {
	return { id, name, path: root, url: 'http://localhost:8881', phpVersion: '8.3' };
}

// The host of the sites given, or, given none, of any folder as a site.
export function liveHost( ...sites: HostSite[] ): StudioAgentHost {
	const byFolder = ( folder: string ) =>
		sites.length
			? sites.find( ( site ) => path.resolve( site.path ) === path.resolve( folder ) )
			: liveSite( folder, 'Site' );
	return {
		...cliAgentHost,
		sites: {
			...cliAgentHost.sites,
			resolve: async ( nameOrPath ) =>
				sites.find( ( site ) => site.name === nameOrPath ) ??
				byFolder( nameOrPath ) ??
				Promise.reject( new Error( `No site ${ nameOrPath }` ) ),
			findByFolder: async ( folder ) => byFolder( folder ),
			all: async () => sites,
			wpCli: async ( site, args ) => {
				await using command = await runWpCliCommand( site as unknown as SiteData, args );
				return {
					exitCode: await command.response.exitCode,
					stdout: await command.response.stdoutText,
					stderr: await command.response.stderrText,
				};
			},
		},
	};
}
