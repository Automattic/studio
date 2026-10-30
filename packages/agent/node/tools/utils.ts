import type { HostSite, StudioAgentHost } from '@studio/agent/node/host';
import type { AnyStudioAgentTool } from '@studio/agent/node/tools/define-tool';

/**
 * PHP that makes the site's first administrator the current user, so what runs
 * after it saves and checks capabilities as an administrator in wp-admin does.
 */
export const AS_ADMINISTRATOR = `wp_set_current_user( (int) ( get_users( array( 'role' => 'administrator', 'number' => 1, 'fields' => 'ID', 'orderby' => 'ID' ) )[0] ?? 0 ) );`;

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

/**
 * Runs PHP with `wp eval` and returns the JSON object it echoes last, past any
 * output WordPress prints before it. `data`, when given, reaches the PHP as
 * the array $data.
 */
export async function wpEvalJson< T >(
	host: StudioAgentHost,
	site: HostSite,
	php: string,
	data?: unknown
): Promise< T > {
	const input =
		data === undefined
			? ''
			: `$data = json_decode( base64_decode( '${ Buffer.from( JSON.stringify( data ) ).toString(
					'base64'
			  ) }' ), true );\n`;
	const output = await runWpCli( host, site, [ 'eval', input + php ] );
	return JSON.parse( output.slice( output.indexOf( '{' ) ) ) as T;
}

export function textResult( text: string ) {
	return {
		content: [ { type: 'text' as const, text } ],
	};
}
