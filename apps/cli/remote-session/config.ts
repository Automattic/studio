import fs from 'fs';
import { readAuthToken } from '@studio/common/lib/shared-config';
import { getRemoteSessionConfigPath } from '@studio/common/lib/well-known-paths';
import { readFile, writeFile } from 'atomically';
import { z } from 'zod';

export const remoteSessionConfigSchema = z.object( {
	base_url: z.string().url().default( 'https://public-api.wordpress.com/wpcom/v2/telegram-bot' ),
	// `token` is the only required field; if omitted everywhere, falls back to the
	// WordPress.com OAuth access token from ~/.studio/shared.json (i.e. /login).
	token: z.string().min( 1 ),
	// Optional pinning. When set, `chat_id` filters polled messages and `bot` overrides
	// the per-message bot identity for outgoing replies. When unset, the controller
	// trusts the server's per-token authorization and echoes chat_id + bot from each
	// polled message back into the response.
	bot: z.string().min( 1 ).optional(),
	chat_id: z.number().int().optional(),
	poll_interval_seconds: z.number().positive().default( 2 ),
	long_poll_timeout_seconds: z.number().positive().default( 25 ),
	max_message_chars: z.number().int().positive().max( 4096 ).default( 3800 ),
	turn_timeout_seconds: z.number().positive().default( 900 ),
} );

export type RemoteSessionConfig = z.infer< typeof remoteSessionConfigSchema >;

export interface RemoteSessionOverrides {
	token?: string;
	bot?: string;
	chat_id?: number;
	base_url?: string;
}

export class RemoteSessionConfigError extends Error {
	constructor(
		message: string,
		public readonly missingFields: string[] = []
	) {
		super( message );
		this.name = 'RemoteSessionConfigError';
	}
}

function readEnvOverrides(): RemoteSessionOverrides {
	const overrides: RemoteSessionOverrides = {};
	if ( process.env.STUDIO_REMOTE_BASE_URL ) {
		overrides.base_url = process.env.STUDIO_REMOTE_BASE_URL;
	}
	if ( process.env.STUDIO_REMOTE_TOKEN ) {
		overrides.token = process.env.STUDIO_REMOTE_TOKEN;
	}
	if ( process.env.STUDIO_REMOTE_BOT ) {
		overrides.bot = process.env.STUDIO_REMOTE_BOT;
	}
	if ( process.env.STUDIO_REMOTE_CHAT_ID ) {
		const parsed = Number( process.env.STUDIO_REMOTE_CHAT_ID );
		if ( Number.isFinite( parsed ) ) {
			overrides.chat_id = parsed;
		}
	}
	return overrides;
}

async function readConfigFile(): Promise< Record< string, unknown > > {
	const configPath = getRemoteSessionConfigPath();
	if ( ! fs.existsSync( configPath ) ) {
		return {};
	}
	try {
		const content = await readFile( configPath, { encoding: 'utf8' } );
		const parsed = JSON.parse( content );
		return parsed && typeof parsed === 'object' ? ( parsed as Record< string, unknown > ) : {};
	} catch {
		return {};
	}
}

/**
 * Load the remote-session config. Resolution order:
 *   1. CLI overrides
 *   2. Env vars (STUDIO_REMOTE_*)
 *   3. ~/.studio/remote-session.json
 *   4. For `token` only: fall back to the WordPress.com OAuth access token from
 *      ~/.studio/shared.json (the same token populated by `studio code` /login).
 *
 * Throws RemoteSessionConfigError listing missing fields when required values are absent.
 */
export async function loadRemoteSessionConfig(
	cliOverrides: RemoteSessionOverrides = {}
): Promise< RemoteSessionConfig > {
	const fileValues = await readConfigFile();
	const envOverrides = readEnvOverrides();
	const merged: Record< string, unknown > = {
		...fileValues,
		...envOverrides,
		...cliOverrides,
	};

	if ( typeof merged.token !== 'string' || merged.token.length === 0 ) {
		const stored = await readAuthToken();
		if ( stored?.accessToken ) {
			merged.token = stored.accessToken;
		}
	}

	const parseResult = remoteSessionConfigSchema.safeParse( merged );
	if ( parseResult.success ) {
		return parseResult.data;
	}

	const missing: string[] = [];
	for ( const issue of parseResult.error.issues ) {
		const field = issue.path[ 0 ];
		if ( typeof field === 'string' && ! missing.includes( field ) ) {
			missing.push( field );
		}
	}
	const required = [ 'token' ].filter( ( f ) => missing.includes( f ) );
	if ( required.length > 0 ) {
		throw new RemoteSessionConfigError(
			`Remote session needs a bearer token to authenticate to ${ '/local-agent-poll' }. ` +
				`Run \`studio code\` and \`/login\` to authenticate to WordPress.com, ` +
				`or set STUDIO_REMOTE_TOKEN, or put a "token" field in ~/.studio/remote-session.json.`,
			required
		);
	}
	throw new RemoteSessionConfigError(
		`Remote session config is invalid: ${ parseResult.error.issues
			.map( ( i ) => `${ i.path.join( '.' ) }: ${ i.message }` )
			.join( '; ' ) }`,
		[]
	);
}

/**
 * Write the config file with mode 0600. Used by ops/tests; the runtime path never writes config.
 */
export async function saveRemoteSessionConfig( config: RemoteSessionConfig ): Promise< void > {
	const configPath = getRemoteSessionConfigPath();
	const content = JSON.stringify( config, null, 2 ) + '\n';
	await writeFile( configPath, content, { encoding: 'utf8', mode: 0o600 } );
	try {
		await fs.promises.chmod( configPath, 0o600 );
	} catch {
		// chmod can fail on Windows; atomically already set mode on create.
	}
}
