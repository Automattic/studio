import { studioHost, type HostSite } from '@studio/agent/node/host';

export function resolveSite( nameOrPath: string ): Promise< HostSite > {
	return studioHost().sites.resolve( nameOrPath );
}

export async function runWpCli( site: HostSite, args: string[] ): Promise< string > {
	const { exitCode, stdout, stderr } = await studioHost().sites.wpCli( site, args );
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
