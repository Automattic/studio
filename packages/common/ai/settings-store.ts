import fs from 'fs';
import path from 'path';
import { readFile, writeFile } from 'atomically';
import { z } from 'zod';
import { CLI_CONFIG_LOCKFILE_NAME, LOCKFILE_STALE_TIME, LOCKFILE_WAIT_TIME } from '../constants';
import { hideDirectoryOnWindows } from '../lib/hide-dir-windows';
import { lockFileAsync, unlockFileAsync } from '../lib/lockfile';
import { getCliConfigPath, getConfigDirectory } from '../lib/well-known-paths';
import { validateAnthropicApiKey } from './anthropic-key';
import { DEFAULT_AI_PROVIDER, isAiProviderId, type AiSettings } from './providers';

/** A key Anthropic definitively rejected; carries a user-facing message. */
export class InvalidAnthropicApiKeyError extends Error {
	constructor( message: string ) {
		super( message );
		this.name = 'InvalidAnthropicApiKeyError';
	}
}

/**
 * Reads and writes the AI provider settings (`aiProvider`, `anthropicApiKey`)
 * stored in the CLI-owned `~/.studio/cli.json`, shared by the CLI, the local
 * web server, and the desktop app. Like the desktop migrations, it validates
 * with a local, loose schema so unrelated cli.json fields pass through the
 * write-back untouched — the CLI remains the owner of the full schema.
 */

// Matches CLI_CONFIG_VERSION in `apps/cli/lib/cli-config/core.ts`; only used
// when creating the file from scratch.
const CLI_CONFIG_VERSION = 1;

const aiSettingsConfigSchema = z
	.object( {
		aiProvider: z.string().optional(),
		anthropicApiKey: z.string().optional(),
	} )
	.loose();

const KEY_SUFFIX_LENGTH = 4;

function toAiSettings( config: z.infer< typeof aiSettingsConfigSchema > ): AiSettings {
	const key = config.anthropicApiKey;
	return {
		provider:
			config.aiProvider !== undefined && isAiProviderId( config.aiProvider )
				? config.aiProvider
				: DEFAULT_AI_PROVIDER,
		hasAnthropicApiKey: Boolean( key ),
		anthropicApiKeySuffix: key ? key.slice( -KEY_SUFFIX_LENGTH ) : null,
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

/**
 * Saves or clears the Anthropic API key and switches the AI provider
 * accordingly: a saved key selects the direct Anthropic provider, clearing it
 * falls back to WordPress.com. Existing sessions keep the provider recorded in
 * their session context; only new sessions pick up the change.
 */
export async function saveAnthropicApiKey( key: string | null ): Promise< AiSettings > {
	const trimmed = key === null ? null : key.trim();
	if ( trimmed === '' ) {
		throw new Error( 'The Anthropic API key must not be empty.' );
	}

	// Refuse keys Anthropic definitively rejects; an unverifiable result
	// (offline, Anthropic outage) still saves so users aren't locked out.
	if ( trimmed !== null ) {
		const validation = await validateAnthropicApiKey( trimmed );
		if ( validation.status === 'invalid' ) {
			throw new InvalidAnthropicApiKeyError( validation.message );
		}
	}

	const configDir = getConfigDirectory();
	if ( ! fs.existsSync( configDir ) ) {
		fs.mkdirSync( configDir, { recursive: true } );
		await hideDirectoryOnWindows( configDir );
	}

	const lockfilePath = path.join( configDir, CLI_CONFIG_LOCKFILE_NAME );
	await lockFileAsync( lockfilePath, { wait: LOCKFILE_WAIT_TIME, stale: LOCKFILE_STALE_TIME } );
	try {
		const config = await readCliConfigRaw();
		if ( trimmed === null ) {
			delete config.anthropicApiKey;
			config.aiProvider = DEFAULT_AI_PROVIDER;
		} else {
			config.anthropicApiKey = trimmed;
			config.aiProvider = 'anthropic-api-key';
		}
		await writeFile( getCliConfigPath(), JSON.stringify( config, null, 2 ) + '\n', {
			encoding: 'utf8',
		} );
		return toAiSettings( aiSettingsConfigSchema.parse( config ) );
	} finally {
		await unlockFileAsync( lockfilePath );
	}
}
