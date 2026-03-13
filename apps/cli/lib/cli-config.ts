import fs from 'fs';
import path from 'path';
import { LOCKFILE_STALE_TIME, LOCKFILE_WAIT_TIME } from '@studio/common/constants';
import { arePathsEqual, isWordPressDirectory } from '@studio/common/lib/fs-utils';
import { lockFileAsync, unlockFileAsync } from '@studio/common/lib/lockfile';
import { siteDetailsSchema } from '@studio/common/lib/site-events';
import { snapshotSchema, type Snapshot } from '@studio/common/types/snapshot';
import { __, sprintf } from '@wordpress/i18n';
import { readFile, writeFile } from 'atomically';
import { z } from 'zod';
import { STUDIO_CLI_HOME } from 'cli/lib/paths';
import { LoggerError } from 'cli/logger';

const siteSchema = siteDetailsSchema
	.extend( {
		url: z.string().optional(),
		latestCliPid: z.number().optional(),
	} )
	.loose();

const cliConfigWithJustVersion = z.object( {
	version: z.number().default( 1 ),
} );
// IMPORTANT: Always consider that independently installed versions of the CLI (from npm) may also
// read this file, and any updates to this schema may require updating the `version` field.
const cliConfigSchema = cliConfigWithJustVersion.extend( {
	sites: z.array( siteSchema ).default( () => [] ),
	snapshots: z.array( snapshotSchema ).default( () => [] ),
} );

type CliConfig = z.infer< typeof cliConfigSchema >;
export type SiteData = z.infer< typeof siteSchema >;

const DEFAULT_CLI_CONFIG: CliConfig = {
	version: 1,
	sites: [],
	snapshots: [],
};

export function getCliConfigDirectory(): string {
	if ( process.env.E2E && process.env.E2E_CLI_CONFIG_PATH ) {
		return process.env.E2E_CLI_CONFIG_PATH;
	}

	return STUDIO_CLI_HOME;
}

export function getCliConfigPath(): string {
	return path.join( getCliConfigDirectory(), 'cli.json' );
}

export async function readCliConfig(): Promise< CliConfig > {
	const configPath = getCliConfigPath();

	if ( ! fs.existsSync( configPath ) ) {
		return structuredClone( DEFAULT_CLI_CONFIG );
	}

	try {
		const fileContent = await readFile( configPath, { encoding: 'utf8' } );
		// eslint-disable-next-line no-var
		var data = JSON.parse( fileContent );
	} catch ( error ) {
		throw new LoggerError( __( 'Failed to read CLI config file.' ), error );
	}

	try {
		return cliConfigSchema.parse( data );
	} catch ( error ) {
		if ( error instanceof z.ZodError ) {
			try {
				cliConfigWithJustVersion.parse( data );
			} catch ( versionError ) {
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
		config.version = 1;

		const configDir = getCliConfigDirectory();
		if ( ! fs.existsSync( configDir ) ) {
			fs.mkdirSync( configDir, { recursive: true } );
		}

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

const LOCKFILE_PATH = path.join( getCliConfigDirectory(), 'cli.json.lock' );

export async function lockCliConfig(): Promise< void > {
	await lockFileAsync( LOCKFILE_PATH, { wait: LOCKFILE_WAIT_TIME, stale: LOCKFILE_STALE_TIME } );
}

export async function unlockCliConfig(): Promise< void > {
	await unlockFileAsync( LOCKFILE_PATH );
}

export async function getSiteByFolder( siteFolder: string ): Promise< SiteData > {
	const config = await readCliConfig();
	const site = config.sites.find( ( site ) => arePathsEqual( site.path, siteFolder ) );

	if ( ! site ) {
		if ( isWordPressDirectory( siteFolder ) ) {
			throw new LoggerError(
				__( 'The specified directory is not added to Studio. Use `studio site create` to add it.' )
			);
		}

		throw new LoggerError( __( 'The specified directory is not added to Studio.' ) );
	}

	return site;
}

export function getSiteUrl( site: SiteData ): string {
	if ( site.url ) {
		return site.url;
	}

	if ( site.customDomain ) {
		const protocol = site.enableHttps ? 'https' : 'http';
		return `${ protocol }://${ site.customDomain }`;
	}

	return `http://localhost:${ site.port }`;
}

export async function updateSiteLatestCliPid( siteId: string, pid: number ): Promise< void > {
	try {
		await lockCliConfig();
		const config = await readCliConfig();
		const site = config.sites.find( ( s ) => s.id === siteId );

		if ( ! site ) {
			throw new LoggerError( __( 'Site not found' ) );
		}

		site.latestCliPid = pid;
		await saveCliConfig( config );
	} finally {
		await unlockCliConfig();
	}
}

export async function clearSiteLatestCliPid( siteId: string ): Promise< void > {
	try {
		await lockCliConfig();
		const config = await readCliConfig();
		const site = config.sites.find( ( s ) => s.id === siteId );

		if ( ! site ) {
			throw new LoggerError( __( 'Site not found' ) );
		}

		delete site.latestCliPid;
		await saveCliConfig( config );
	} finally {
		await unlockCliConfig();
	}
}

export async function updateSiteAutoStart( siteId: string, autoStart: boolean ): Promise< void > {
	try {
		await lockCliConfig();
		const config = await readCliConfig();
		const site = config.sites.find( ( s ) => s.id === siteId );

		if ( ! site ) {
			throw new LoggerError( __( 'Site not found' ) );
		}

		site.autoStart = autoStart;
		await saveCliConfig( config );
	} finally {
		await unlockCliConfig();
	}
}

export async function removeSiteFromConfig( siteId: string ): Promise< void > {
	try {
		await lockCliConfig();
		const config = await readCliConfig();
		config.sites = config.sites.filter( ( s ) => s.id !== siteId );
		await saveCliConfig( config );
	} finally {
		await unlockCliConfig();
	}
}

export async function getSnapshotsFromConfig(
	userId: number,
	siteFolder?: string
): Promise< Snapshot[] > {
	const config = await readCliConfig();
	let snapshots = config.snapshots.filter( ( snapshot ) => snapshot.userId === userId );

	if ( siteFolder ) {
		const site = await getSiteByFolder( siteFolder );
		snapshots = snapshots.filter( ( snapshot ) => snapshot.localSiteId === site.id );
	}

	return snapshots;
}

export async function saveSnapshotToConfig(
	siteFolder: string,
	atomicSiteId: number,
	previewUrl: string,
	userId: number,
	name?: string
): Promise< Snapshot > {
	try {
		const site = await getSiteByFolder( siteFolder );
		await lockCliConfig();
		const config = await readCliConfig();

		const nextSequenceNumber = getNextSnapshotSequence( site.id, config.snapshots, userId );
		const snapshot: Snapshot = {
			url: previewUrl,
			atomicSiteId,
			localSiteId: site.id,
			date: Date.now(),
			name:
				name ||
				sprintf(
					/* translators: 1: Site name 2: Sequence number (e.g. "My Site Name Preview 1") */
					__( '%1$s Preview %2$d' ),
					site.name,
					nextSequenceNumber
				),
			sequence: nextSequenceNumber,
			userId,
		};

		config.snapshots.push( snapshot );
		await saveCliConfig( config );
		return snapshot;
	} finally {
		await unlockCliConfig();
	}
}

export async function updateSnapshotInConfig(
	atomicSiteId: number,
	siteFolder: string
): Promise< Snapshot > {
	try {
		const site = await getSiteByFolder( siteFolder );
		await lockCliConfig();
		const config = await readCliConfig();
		const snapshot = config.snapshots.find( ( s ) => s.atomicSiteId === atomicSiteId );
		if ( ! snapshot ) {
			throw new LoggerError( __( 'Failed to find existing preview site in config' ) );
		}

		snapshot.localSiteId = site.id;
		snapshot.date = Date.now();

		await saveCliConfig( config );
		return snapshot;
	} finally {
		await unlockCliConfig();
	}
}

export async function deleteSnapshotFromConfig( snapshotUrl: string ): Promise< void > {
	try {
		await lockCliConfig();
		const config = await readCliConfig();
		const filtered = config.snapshots.filter( ( s ) => s.url !== snapshotUrl );
		if ( filtered.length === config.snapshots.length ) {
			return;
		}
		config.snapshots = filtered;
		await saveCliConfig( config );
	} finally {
		await unlockCliConfig();
	}
}

export async function setSnapshotInConfig(
	snapshotUrl: string,
	updates: { name?: string }
): Promise< Snapshot > {
	try {
		await lockCliConfig();
		const config = await readCliConfig();
		const snapshot = config.snapshots.find( ( s ) => s.url === snapshotUrl );
		if ( ! snapshot ) {
			throw new LoggerError( __( 'Preview site not found in config' ) );
		}

		if ( updates.name !== undefined ) {
			snapshot.name = updates.name;
		}

		await saveCliConfig( config );
		return snapshot;
	} finally {
		await unlockCliConfig();
	}
}

function getNextSnapshotSequence( siteId: string, snapshots: Snapshot[], userId: number ): number {
	const siteSnapshots = snapshots.filter(
		( s ) => s.localSiteId === siteId && s.userId === userId
	);

	const existingSequences = siteSnapshots
		.map( ( s ) => s.sequence ?? 0 )
		.filter( ( n ) => ! isNaN( n ) );

	return existingSequences.length > 0
		? Math.max( ...existingSequences ) + 1
		: siteSnapshots.length + 1;
}
