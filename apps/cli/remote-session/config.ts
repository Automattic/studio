import fs from 'fs';
import { getRemoteSessionConfigPath } from '@studio/common/lib/well-known-paths';
import { readFile, writeFile } from 'atomically';
import { z } from 'zod';

export const remoteSessionConfigSchema = z.object( {
	base_url: z.string().url().default( 'https://public-api.wordpress.com/wpcom/v2/telegram-bot' ),
	token: z.string().min( 1 ),
	bot: z.string().min( 1 ),
	chat_id: z.number().int(),
	poll_interval_seconds: z.number().positive().default( 2 ),
	long_poll_timeout_seconds: z.number().positive().default( 25 ),
	max_message_chars: z.number().int().positive().max( 4096 ).default( 3800 ),
	turn_timeout_seconds: z.number().positive().default( 300 ),
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
 * Load the remote-session config. Priority: CLI overrides > env vars > config file.
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
	const required = [ 'token', 'bot', 'chat_id' ].filter( ( f ) => missing.includes( f ) );
	const message =
		required.length > 0
			? `Remote session config is missing required fields: ${ required.join( ', ' ) }. ` +
			  `Set them in ~/.studio/remote-session.json, via environment variables ` +
			  `(STUDIO_REMOTE_TOKEN, STUDIO_REMOTE_BOT, STUDIO_REMOTE_CHAT_ID), or via CLI flags.`
			: `Remote session config is invalid: ${ parseResult.error.issues
					.map( ( i ) => `${ i.path.join( '.' ) }: ${ i.message }` )
					.join( '; ' ) }`;
	throw new RemoteSessionConfigError( message, required );
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
