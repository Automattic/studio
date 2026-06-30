import fs from 'fs';
import path from 'path';
import {
	CLI_CONFIG_LOCKFILE_NAME,
	LOCKFILE_STALE_TIME,
	LOCKFILE_WAIT_TIME,
} from '@studio/common/constants';
import { siteDetailsSchema } from '@studio/common/lib/cli-events';
import { hideDirectoryOnWindows } from '@studio/common/lib/hide-dir-windows';
import { lockFileAsync, unlockFileAsync } from '@studio/common/lib/lockfile';
import { getCliConfigPath, getConfigDirectory } from '@studio/common/lib/well-known-paths';
import { snapshotSchema } from '@studio/common/types/snapshot';
import { __ } from '@wordpress/i18n';
import { readFile, writeFile } from 'atomically';
import { z } from 'zod';
import { StatsMetric } from 'cli/lib/types/bump-stats';
import { LoggerError } from 'cli/logger';

/**
 * Durable origin of a site that was populated by `studio pull-reprint`:
 * where it syncs from and the credential needed to talk to that remote.
 * Present only on reprint-pulled sites.
 */
export const reprintOriginSchema = z.object( {
	remoteUrl: z.string(),
	remoteSiteUrl: z.string().optional(),
	tablePrefix: z.string().optional(),
	secret: z.string(),
} );

const siteSchema = siteDetailsSchema
	.extend( {
		url: z.string().optional(),
		latestCliPid: z.number().optional(),
		reprintOrigin: reprintOriginSchema.optional(),
		// True once a full reprint pull has completed at least once; selects
		// first-full-pull vs. delta and survives loss of the transient pull.json.
		importComplete: z.boolean().optional(),
	} )
	.loose();

// Schema updates must maintain backwards compatibility. If a breaking change is needed,
// increment CLI_CONFIG_VERSION and add a data migration function.
const CLI_CONFIG_VERSION = 1;

// IMPORTANT: Always consider that independently installed versions of the CLI (from npm) may also
// read this file, and any updates to this schema may require updating the `version` field.
export const aiProviderSchema = z.enum( [ 'wpcom', 'anthropic-api-key' ] );

export const updateCheckSchema = z.object( {
	lastChecked: z.number(),
	latestVersion: z.string(),
} );

const cliConfigSchema = z.looseObject( {
	version: z.literal( CLI_CONFIG_VERSION ),
	sites: z.array( siteSchema ).default( () => [] ),
	snapshots: z.array( snapshotSchema ).default( () => [] ),
	aiProvider: aiProviderSchema.optional(),
	anthropicApiKey: z.string().optional(),
	lastBumpStats: z
		.record( z.string(), z.partialRecord( z.enum( StatsMetric ), z.number() ) )
		.optional(),
	// Per-site daily dedup markers for the runtime adoption stat (RSM-3958).
	siteRuntimeStats: z
		.record( z.string(), z.object( { bumpedAt: z.number(), stat: z.string() } ) )
		.optional(),
	lastDependencyCheckTime: z.number().optional(),
	updateCheck: updateCheckSchema.optional(),
	// Same shape as `updateCheck`, but for standalone (curl) installs that check the CDN endpoint.
	standaloneUpdateCheck: updateCheckSchema.optional(),
	// Unix ms timestamp of when the one-time ToS/Privacy notice was displayed.
	tosNoticeShownAt: z.number().optional(),
} );

type CliConfig = z.infer< typeof cliConfigSchema >;
export type SiteData = z.infer< typeof siteSchema >;

const DEFAULT_CLI_CONFIG: CliConfig = {
	version: CLI_CONFIG_VERSION,
	sites: [],
	snapshots: [],
};

export async function readCliConfig(): Promise< CliConfig > {
	const configPath = getCliConfigPath();

	if ( ! fs.existsSync( configPath ) ) {
		return structuredClone( DEFAULT_CLI_CONFIG );
	}

	let data: Record< string, unknown >;
	try {
		const fileContent = await readFile( configPath, { encoding: 'utf8' } );
		data = JSON.parse( fileContent );
	} catch ( error ) {
		throw new LoggerError( __( 'Failed to read CLI config file.' ), error );
	}

	try {
		return cliConfigSchema.parse( data );
	} catch ( error ) {
		if ( error instanceof z.ZodError ) {
			if ( typeof data?.version === 'number' && data.version !== CLI_CONFIG_VERSION ) {
				throw new LoggerError(
					__(
						'Invalid CLI config version. It looks like you have a different version of the `studio` CLI installed on your system. Please modify your $PATH environment variable to use the correct version.'
					),
					error
				);
			}

			throw new LoggerError( __( 'Invalid CLI config file format.' ), error );
		}

		if ( error instanceof SyntaxError ) {
			throw new LoggerError( __( 'CLI config file is corrupted.' ), error );
		}

		throw new LoggerError( __( 'Failed to read CLI config file.' ), error );
	}
}

async function ensureConfigDirectory(): Promise< void > {
	const configDir = getConfigDirectory();
	if ( ! fs.existsSync( configDir ) ) {
		fs.mkdirSync( configDir, { recursive: true } );
		await hideDirectoryOnWindows( configDir );
	}
}

export async function saveCliConfig( config: CliConfig ): Promise< void > {
	try {
		config.version = CLI_CONFIG_VERSION;

		await ensureConfigDirectory();

		const configPath = getCliConfigPath();
		const fileContent = JSON.stringify( config, null, 2 ) + '\n';

		await writeFile( configPath, fileContent, { encoding: 'utf8' } );
	} catch ( error ) {
		if ( error instanceof LoggerError ) {
			throw error;
		}
		throw new LoggerError( __( 'Failed to save CLI config file' ), error );
	}
}

const LOCKFILE_PATH = path.join( getConfigDirectory(), CLI_CONFIG_LOCKFILE_NAME );

export async function lockCliConfig(): Promise< void > {
	// The lockfile lives inside the config directory. On a first run that directory may not exist
	// yet (e.g. telemetry bumps fire before `setupServerFiles()` creates it), and `lockfile.lock`
	// would reject with ENOENT instead of waiting. Ensure the directory exists before locking.
	await ensureConfigDirectory();
	await lockFileAsync( LOCKFILE_PATH, { wait: LOCKFILE_WAIT_TIME, stale: LOCKFILE_STALE_TIME } );
}

export async function unlockCliConfig(): Promise< void > {
	await unlockFileAsync( LOCKFILE_PATH );
}

export async function updateCliConfigWithPartial(
	update: Partial< Omit< CliConfig, 'version' | 'sites' > >
): Promise< void > {
	try {
		await lockCliConfig();
		const config = await readCliConfig();
		const updated = { ...config, ...update };
		await saveCliConfig( updated );
	} finally {
		await unlockCliConfig();
	}
}
