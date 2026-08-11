import fs from 'fs';
import path from 'path';
import { readFile, writeFile } from 'atomically';
import { z } from 'zod';
import { CLI_CONFIG_LOCKFILE_NAME, LOCKFILE_STALE_TIME, LOCKFILE_WAIT_TIME } from '../constants';
import { hideDirectoryOnWindows } from '../lib/hide-dir-windows';
import { lockFileAsync, unlockFileAsync } from '../lib/lockfile';
import { getCliConfigPath, getConfigDirectory } from '../lib/well-known-paths';
import { validateAnthropicApiKey } from './anthropic-key';
import {
	DEFAULT_AI_PROVIDER,
	isAiProviderId,
	type AiProviderId,
	type AiSettings,
} from './providers';

/** A key Anthropic definitively rejected; carries a user-facing message. */
export class InvalidAnthropicApiKeyError extends Error {
	constructor( message: string ) {
		super( message );
		this.name = 'InvalidAnthropicApiKeyError';
	}
}

/**
 * Reads and writes the AI provider settings in the CLI-owned
 * `~/.studio/cli.json`, shared by the CLI, the local web server and the desktop
 * app. The schema here is loose on purpose: the CLI owns the full one, so
 * unrelated fields must survive the write-back untouched.
 */

// Matches CLI_CONFIG_VERSION in `apps/cli/lib/cli-config/core.ts`; only used
// when creating the file.
const CLI_CONFIG_VERSION = 1;

const aiSettingsConfigSchema = z
	.object( {
		aiProvider: z.string().optional(),
		anthropicApiKey: z.string().optional(),
	} )
	.loose();

const KEY_PREFIX_LENGTH = 16;
const KEY_SUFFIX_LENGTH = 4;

// Enough of the key to recognise it, never enough to use it.
function previewKey( key: string ): string {
	if ( key.length <= KEY_PREFIX_LENGTH + KEY_SUFFIX_LENGTH ) {
		return key.slice( 0, KEY_PREFIX_LENGTH );
	}
	return `${ key.slice( 0, KEY_PREFIX_LENGTH ) }...${ key.slice( -KEY_SUFFIX_LENGTH ) }`;
}

function toAiSettings( config: z.infer< typeof aiSettingsConfigSchema > ): AiSettings {
	const key = config.anthropicApiKey;
	return {
		provider:
			config.aiProvider !== undefined && isAiProviderId( config.aiProvider )
				? config.aiProvider
				: DEFAULT_AI_PROVIDER,
		hasAnthropicApiKey: Boolean( key ),
		anthropicApiKeyPreview: key ? previewKey( key ) : null,
	};
}

async function readCliConfigRaw(): Promise< Record< string, unknown > > {
	const configPath = getCliConfigPath();
	if ( ! fs.existsSync( configPath ) ) {
		return { version: CLI_CONFIG_VERSION, sites: [], snapshots: [] };
	}
	const parsed: unknown = JSON.parse( await readFile( configPath, { encoding: 'utf8' } ) );
	if ( typeof parsed !== 'object' || parsed === null ) {
		throw new Error( 'Invalid CLI config file format.' );
	}
	return parsed as Record< string, unknown >;
}

export async function readAiSettings(): Promise< AiSettings > {
	return toAiSettings( aiSettingsConfigSchema.parse( await readCliConfigRaw() ) );
}

async function updateAiSettings(
	mutate: ( config: Record< string, unknown > ) => void
): Promise< AiSettings > {
	const configDir = getConfigDirectory();
	if ( ! fs.existsSync( configDir ) ) {
		fs.mkdirSync( configDir, { recursive: true } );
		await hideDirectoryOnWindows( configDir );
	}

	const lockfilePath = path.join( configDir, CLI_CONFIG_LOCKFILE_NAME );
	await lockFileAsync( lockfilePath, { wait: LOCKFILE_WAIT_TIME, stale: LOCKFILE_STALE_TIME } );
	try {
		const config = await readCliConfigRaw();
		mutate( config );
		await writeFile( getCliConfigPath(), JSON.stringify( config, null, 2 ) + '\n', {
			encoding: 'utf8',
		} );
		return toAiSettings( aiSettingsConfigSchema.parse( config ) );
	} finally {
		await unlockFileAsync( lockfilePath );
	}
}

/**
 * Stores or clears the Anthropic API key. A key Anthropic rejects is not
 * stored; an unverifiable one (offline, Anthropic outage) is. Clearing the key
 * falls back to WordPress.com, since the Anthropic provider needs one.
 */
export async function saveAnthropicApiKey( key: string | null ): Promise< AiSettings > {
	const trimmed = key === null ? null : key.trim();

	if ( trimmed ) {
		const validation = await validateAnthropicApiKey( trimmed );
		if ( validation.status === 'invalid' ) {
			throw new InvalidAnthropicApiKeyError( validation.message );
		}
	}

	return updateAiSettings( ( config ) => {
		if ( ! trimmed ) {
			delete config.anthropicApiKey;
			config.aiProvider = DEFAULT_AI_PROVIDER;
		} else {
			config.anthropicApiKey = trimmed;
		}
	} );
}

/**
 * Selects the provider for new conversations. Switching to Anthropic refuses a
 * key Anthropic rejects, but accepts an unverifiable one. Existing sessions
 * keep the provider recorded in their session context.
 */
export async function setAiProvider( provider: AiProviderId ): Promise< AiSettings > {
	if ( provider === 'anthropic-api-key' ) {
		const { anthropicApiKey } = aiSettingsConfigSchema.parse( await readCliConfigRaw() );
		if ( ! anthropicApiKey ) {
			throw new InvalidAnthropicApiKeyError( 'Add an Anthropic API key first.' );
		}
		const validation = await validateAnthropicApiKey( anthropicApiKey );
		if ( validation.status === 'invalid' ) {
			throw new InvalidAnthropicApiKeyError( validation.message );
		}
	}

	return updateAiSettings( ( config ) => {
		config.aiProvider = provider;
	} );
}
