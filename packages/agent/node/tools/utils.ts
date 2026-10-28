import type { HostSite, StudioAgentHost } from '@studio/agent/node/host';

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
