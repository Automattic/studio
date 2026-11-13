import { toBase64 } from '@studio/agent/shared/base64';
import type { HostSite, StudioAgentHost } from '@studio/agent/shared/host';
import type { AnyStudioAgentTool } from '@studio/agent/shared/tools/define-tool';

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

/** Runs PHP with `wp eval`; `data`, when given, reaches the PHP as the array $data. */
export async function wpEval(
	host: StudioAgentHost,
	site: HostSite,
	php: string,
	data?: unknown
): Promise< string > {
	const input =
		data === undefined
			? ''
			: `$data = json_decode( base64_decode( '${ toBase64(
					new TextEncoder().encode( JSON.stringify( data ) )
			  ) }' ), true );\n`;
	return runWpCli( host, site, [ 'eval', input + php ] );
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
	const output = await wpEval( host, site, php, data );
	return JSON.parse( output.slice( output.indexOf( '{' ) ) ) as T;
}

/** The JSON WordPress printed after `marker`, on its line. */
export function printedJson< T >( output: string, marker: string ): T {
	const at = output.indexOf( marker );
	if ( at === -1 ) {
		throw new Error( `WordPress printed no ${ marker } line: ${ output.slice( 0, 500 ) }` );
	}
	return JSON.parse( output.slice( at + marker.length ).split( '\n' )[ 0 ] ) as T;
}

/** What `run` returns; when it throws, an error of its message after `prefix`. */
export async function failsAs< T >( prefix: string, run: () => Promise< T > ): Promise< T > {
	try {
		return await run();
	} catch ( error ) {
		throw new Error( `${ prefix }: ${ error instanceof Error ? error.message : String( error ) }` );
	}
}

/** A name as a slug: lowercase ASCII letters and digits, dash-separated. */
export function slugify( name: string ): string {
	return name
		.toLowerCase()
		.replace( /[^a-z0-9]+/g, '-' )
		.replace( /^-|-$/g, '' );
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
