import type { HostSite, StudioAgentHost } from '@studio/agent/shared/host';

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

export async function withTimeout< T >(
	promise: Promise< T >,
	ms: number,
	label: string
): Promise< T > {
	let timer: ReturnType< typeof setTimeout > | undefined;
	try {
		return await Promise.race( [
			promise,
			new Promise< never >( ( _, reject ) => {
				timer = setTimeout(
					() => reject( new Error( `${ label } timed out after ${ ms / 1000 }s` ) ),
					ms
				);
			} ),
		] );
	} finally {
		clearTimeout( timer );
	}
}
