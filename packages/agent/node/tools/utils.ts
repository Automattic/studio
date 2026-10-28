import type { HostSite, StudioAgentHost } from '@studio/agent/node/host';
import type { AnyStudioAgentTool } from '@studio/agent/node/tools/define-tool';

/** The local site a call names, by the tool's site argument; undefined when it names none. */
export async function siteOfCall(
	host: StudioAgentHost,
	tool: object,
	args: unknown
): Promise< HostSite | undefined > {
	const { siteParam = 'nameOrPath' } = tool as Pick< AnyStudioAgentTool, 'siteParam' >;
	const named = ( args as Record< string, unknown > | undefined )?.[ siteParam ];
	return typeof named === 'string'
		? host.sites.resolve( named ).catch( () => undefined )
		: undefined;
}

export async function runWpCli(
	host: StudioAgentHost,
	site: HostSite,
	args: string[]
): Promise< string > {
	const { exitCode, stdout, stderr } = await host.sites.wpCli( site, args );
	if ( exitCode !== 0 ) {
		const detail = ( stderr || stdout ).trim();
		throw new Error( `WP-CLI exited with code ${ exitCode }${ detail ? `: ${ detail }` : '' }` );
	}
	return stdout;
}

export function textResult( text: string ) {
	return {
		content: [ { type: 'text' as const, text } ],
	};
}
