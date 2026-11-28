import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { isTailnetAddress } from './network-address';

// What remote mode needs to know about Tailscale on this computer.
export type TailscaleState =
	| { installed: false }
	| {
			installed: true;
			running: boolean;
			// This computer's address on the tailnet.
			ipv4?: string;
			// `<machine>.<tailnet>.ts.net`, without the trailing dot.
			dnsName?: string;
			// The tailnet gives this computer HTTPS certificates.
			httpsReady: boolean;
	  };

const NOT_RUNNING: TailscaleState = { installed: true, running: false, httpsReady: false };

// The macOS app bundles its CLI, and installs a copy on `PATH` only if the
// person asks for it.
const MAC_APP_CLI = '/Applications/Tailscale.app/Contents/MacOS/Tailscale';

export function findTailscaleCli( {
	platform = process.platform,
	env = process.env,
	exists = existsSync,
}: {
	platform?: NodeJS.Platform;
	env?: NodeJS.ProcessEnv;
	exists?: ( file: string ) => boolean;
} = {} ): string | undefined {
	const paths = platform === 'win32' ? path.win32 : path.posix;
	const name = platform === 'win32' ? 'tailscale.exe' : 'tailscale';
	for ( const dir of ( env.PATH ?? env.Path ?? '' ).split( paths.delimiter ) ) {
		if ( dir && exists( paths.join( dir, name ) ) ) {
			return paths.join( dir, name );
		}
	}
	const fallback =
		platform === 'darwin'
			? MAC_APP_CLI
			: platform === 'win32'
			? paths.join( env.ProgramFiles ?? 'C:\\Program Files', 'Tailscale', 'tailscale.exe' )
			: undefined;
	return fallback && exists( fallback ) ? fallback : undefined;
}

// The macOS app's binary opens the app instead of acting as the CLI unless
// this is set. Other platforms ignore it.
export function tailscaleEnv( env: NodeJS.ProcessEnv = process.env ): NodeJS.ProcessEnv {
	return { ...env, TAILSCALE_BE_CLI: '1' };
}

// Tailscale says the format of `status --json` may change: anything missing or
// unexpected reads as "not ready", never as an error.
const statusSchema = z
	.object( {
		BackendState: z.string().nullish(),
		Self: z
			.object( {
				DNSName: z.string().nullish(),
				TailscaleIPs: z.array( z.string() ).nullish(),
			} )
			.loose()
			.nullish(),
		CertDomains: z.array( z.string() ).nullish(),
	} )
	.loose();

export function parseTailscaleStatus( value: unknown ): TailscaleState {
	const parsed = statusSchema.safeParse( value );
	if ( ! parsed.success ) {
		return NOT_RUNNING;
	}
	const { BackendState, Self, CertDomains } = parsed.data;
	const dnsName = Self?.DNSName?.replace( /\.$/, '' ) || undefined;
	return {
		installed: true,
		running: BackendState === 'Running',
		ipv4: Self?.TailscaleIPs?.find( isTailnetAddress ),
		dnsName,
		httpsReady: !! dnsName && ( CertDomains ?? [] ).includes( dnsName ),
	};
}

type RunFile = (
	file: string,
	args: string[],
	options: { env: NodeJS.ProcessEnv; timeout: number; maxBuffer: number }
) => Promise< string >;

const runFile: RunFile = ( file, args, options ) =>
	new Promise( ( resolve, reject ) => {
		execFile( file, args, { ...options, windowsHide: true }, ( error, stdout ) =>
			error ? reject( error ) : resolve( stdout )
		);
	} );

export async function readTailscaleState( {
	find = findTailscaleCli,
	run = runFile,
}: { find?: () => string | undefined; run?: RunFile } = {} ): Promise< TailscaleState > {
	const cli = find();
	if ( ! cli ) {
		return { installed: false };
	}
	try {
		// Without the peers, which a large tailnet lists by the thousand.
		const output = await run( cli, [ 'status', '--json', '--peers=false' ], {
			env: tailscaleEnv(),
			timeout: 5000,
			maxBuffer: 16 * 1024 * 1024,
		} );
		return parseTailscaleStatus( JSON.parse( output ) );
	} catch {
		return NOT_RUNNING;
	}
}
