import fs from 'fs';
import {
	CLI_CONFIG_VERSION,
	ensureCliConfigDirectory,
	lockCliConfigFile,
	readCliConfigFileRaw,
	unlockCliConfigFile,
	writeCliConfigFileRaw,
} from '@studio/common/lib/cli-config-file';
import { siteDetailsSchema } from '@studio/common/lib/cli-events';
import { siteOperationSchema } from '@studio/common/lib/site-operation';
import { getCliConfigPath } from '@studio/common/lib/well-known-paths';
import { snapshotSchema } from '@studio/common/types/snapshot';
import { __ } from '@wordpress/i18n';
import { z } from 'zod';
import { StatsMetric } from 'cli/lib/types/bump-stats';
import { LoggerError } from 'cli/logger';

/**
 * Durable origin of a site that was populated by `studio pull-reprint`:
 * where it syncs from. Present only on reprint-pulled sites.
 */
export const reprintOriginSchema = z.object( {
	remoteUrl: z.string(),
	remoteSiteUrl: z.string().optional(),
	tablePrefix: z.string().optional(),
} );

/**
 * Health of a site's local install.
 *
 *   - `ready`        a normal, fully-written site (the default; `site
 *                    create` produces one and a successful pull restores
 *                    one).
 *   - `pulling`      a reprint pull is in flight (or was interrupted
 *                    mid-flight) — the site directory may be partially
 *                    written and must not be trusted as a healthy site.
 *   - `pull-failed`  the last reprint pull errored or was killed; the
 *                    site is half-written. Recovered by re-running
 *                    `pull-reprint --path <site>` (idempotent) or `site
 *                    delete`.
 *
 * Absent on records created before this field existed; readers treat a
 * missing value as `ready`.
 */
export const siteStatusSchema = z.enum( [ 'ready', 'pulling', 'pull-failed' ] );
export type SiteStatus = z.infer< typeof siteStatusSchema >;

const siteSchema = siteDetailsSchema
	.extend( {
		url: z.string().optional(),
		latestCliPid: z.number().optional(),
		reprintOrigin: reprintOriginSchema.optional(),
		// True once a full reprint pull has completed at least once; selects
		// first-full-pull vs. delta. Durable on the site record.
		importComplete: z.boolean().optional(),
		status: siteStatusSchema.default( 'ready' ).optional(),
		// The in-flight Studio operation holding this site. Unlike `status`, it's
		// transient: once its owning process is gone it's reclaimed on the next
		// acquire. See `cli/lib/site-operations`.
		operation: siteOperationSchema.optional(),
	} )
	.loose();

// Schema updates must maintain backwards compatibility. If a breaking change is needed,
// increment CLI_CONFIG_VERSION (in @studio/common/lib/cli-config-file) and add a data migration
// function.

// IMPORTANT: Always consider that independently installed versions of the CLI (from npm) may also
// read this file, and any updates to this schema may require updating the `version` field.
// A user-configured OpenAI-compatible endpoint (local model server: vLLM,
// Apfel, LM Studio, Ollama, …). Stored as an array so multiple endpoints can
// be supported later without a breaking migration; today only the first entry
// (the active endpoint) is used.
export const openAiCompatibleEndpointSchema = z.object( {
	baseUrl: z.string(),
	apiKey: z.string().optional(),
	// Model id selected on this endpoint (from its /v1/models list).
	selectedModel: z.string().optional(),
	// Real context window of the selected model, discovered from /v1/models.
	// Drives the pi runtime's native compaction. Optional override / fallback.
	contextWindow: z.number().optional(),
} );

export const updateCheckSchema = z.object( {
	lastChecked: z.number(),
	latestVersion: z.string(),
} );

const cliConfigSchema = z.looseObject( {
	version: z.literal( CLI_CONFIG_VERSION ),
	sites: z.array( siteSchema ).default( () => [] ),
	snapshots: z.array( snapshotSchema ).default( () => [] ),
	openAiCompatibleEndpoints: z.array( openAiCompatibleEndpointSchema ).optional(),
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
export type OpenAiCompatibleEndpoint = z.infer< typeof openAiCompatibleEndpointSchema >;

const DEFAULT_CLI_CONFIG: CliConfig = {
	version: CLI_CONFIG_VERSION,
	sites: [],
	snapshots: [],
};

export async function readCliConfig(): Promise< CliConfig > {
	if ( ! fs.existsSync( getCliConfigPath() ) ) {
		return structuredClone( DEFAULT_CLI_CONFIG );
	}

	let data: Record< string, unknown >;
	try {
		data = await readCliConfigFileRaw();
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

export async function saveCliConfig( config: CliConfig ): Promise< void > {
	try {
		config.version = CLI_CONFIG_VERSION;
		await ensureCliConfigDirectory();
		await writeCliConfigFileRaw( config );
	} catch ( error ) {
		if ( error instanceof LoggerError ) {
			throw error;
		}
		throw new LoggerError( __( 'Failed to save CLI config file' ), error );
	}
}

export const lockCliConfig = lockCliConfigFile;
export const unlockCliConfig = unlockCliConfigFile;

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

/**
 * The active OpenAI-compatible endpoint — the first configured entry. Returns
 * undefined when none is configured.
 */
export async function getActiveOpenAiCompatibleEndpoint(): Promise<
	OpenAiCompatibleEndpoint | undefined
> {
	const { openAiCompatibleEndpoints } = await readCliConfig();
	return openAiCompatibleEndpoints?.[ 0 ];
}

/**
 * Persist the active OpenAI-compatible endpoint (index 0), leaving any other
 * configured endpoints untouched.
 */
export async function saveActiveOpenAiCompatibleEndpoint(
	endpoint: OpenAiCompatibleEndpoint
): Promise< void > {
	try {
		await lockCliConfig();
		const config = await readCliConfig();
		const rest = ( config.openAiCompatibleEndpoints ?? [] ).slice( 1 );
		await saveCliConfig( { ...config, openAiCompatibleEndpoints: [ endpoint, ...rest ] } );
	} finally {
		await unlockCliConfig();
	}
}
