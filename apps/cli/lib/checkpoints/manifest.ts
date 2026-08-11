import fs from 'fs';
import fsPromises from 'fs/promises';
import path from 'path';
import { LOCKFILE_STALE_TIME, LOCKFILE_WAIT_TIME } from '@studio/common/constants';
import { lockFileAsync, unlockFileAsync } from '@studio/common/lib/lockfile';
import { getConfigDirectory } from '@studio/common/lib/well-known-paths';
import { __, sprintf } from '@wordpress/i18n';
import { writeFile } from 'atomically';
import { z } from 'zod';

// Bump when the manifest/index format changes incompatibly. Readers refuse
// higher versions: independently installed CLI builds (npm + bundled) share
// `~/.studio`, so an old build must never misread a newer store.
export const CHECKPOINT_STORE_VERSION = 1;

export const checkpointTriggerSchema = z.enum( [
	'manual',
	'agent',
	'auto-pre-tool',
	'pre-restore',
] );
export type CheckpointTrigger = z.infer< typeof checkpointTriggerSchema >;

// A stored object reference. `z` records whether the object's bytes are
// gzip-compressed — readers and the garbage collector never guess encoding.
export const objectRefSchema = z.object( {
	hash: z.string(),
	size: z.number(),
	z: z.boolean(),
} );
export type ObjectRef = z.infer< typeof objectRefSchema >;

export const manifestFileEntrySchema = z.union( [
	objectRefSchema.extend( {
		mode: z.number(),
		mtimeMs: z.number(),
		// Original (pre-compression) size; with mtimeMs it forms the
		// skip-rehash fast path for unchanged files.
		logicalSize: z.number(),
	} ),
	z.object( {
		symlink: z.string(),
	} ),
] );
export type ManifestFileEntry = z.infer< typeof manifestFileEntrySchema >;
export type ManifestFileObjectEntry = Extract< ManifestFileEntry, { hash: string } >;

export const databaseCaptureMethodSchema = z.enum( [ 'vacuum', 'file-copy' ] );

export const checkpointManifestSchema = z.object( {
	version: z.literal( CHECKPOINT_STORE_VERSION ),
	id: z.string(),
	siteId: z.string(),
	label: z.string().optional(),
	createdAt: z.number(),
	trigger: checkpointTriggerSchema,
	agentRunId: z.string().optional(),
	toolName: z.string().optional(),
	phpVersion: z.string().optional(),
	wpVersion: z.string().optional(),
	db: objectRefSchema.extend( {
		capture: databaseCaptureMethodSchema,
	} ),
	// Keys are `/`-normalized paths relative to the site root.
	files: z.record( z.string(), manifestFileEntrySchema ),
	stats: z.object( {
		fileCount: z.number(),
		logicalBytes: z.number(),
		newObjectBytes: z.number(),
	} ),
} );
export type CheckpointManifest = z.infer< typeof checkpointManifestSchema >;

// The index is the source of truth for which checkpoints exist. A manifest
// with no index entry is garbage (an interrupted create), never corruption.
export const checkpointIndexEntrySchema = z.object( {
	id: z.string(),
	label: z.string().optional(),
	createdAt: z.number(),
	trigger: checkpointTriggerSchema,
	toolName: z.string().optional(),
	// Pinned entries are exempt from retention pruning. Restore pins its
	// target so a concurrent create's prune can't evict it mid-restore.
	pinned: z.boolean().optional(),
	stats: z.object( {
		fileCount: z.number(),
		logicalBytes: z.number(),
		newObjectBytes: z.number(),
	} ),
} );
export type CheckpointIndexEntry = z.infer< typeof checkpointIndexEntrySchema >;

export const checkpointIndexSchema = z.object( {
	version: z.literal( CHECKPOINT_STORE_VERSION ),
	// Ordered oldest → newest.
	checkpoints: z.array( checkpointIndexEntrySchema ).default( () => [] ),
} );
export type CheckpointIndex = z.infer< typeof checkpointIndexSchema >;

export const restoreJournalSchema = z.object( {
	version: z.literal( CHECKPOINT_STORE_VERSION ),
	checkpointId: z.string(),
	safetyCheckpointId: z.string().optional(),
	startedAt: z.number(),
} );
export type RestoreJournal = z.infer< typeof restoreJournalSchema >;

export function getCheckpointsRootDirectory(): string {
	return path.join( getConfigDirectory(), 'checkpoints' );
}

export function getCheckpointStoreDirectory( siteId: string ): string {
	return path.join( getCheckpointsRootDirectory(), siteId );
}

export function getObjectsDirectory( siteId: string ): string {
	return path.join( getCheckpointStoreDirectory( siteId ), 'objects' );
}

export function getManifestsDirectory( siteId: string ): string {
	return path.join( getCheckpointStoreDirectory( siteId ), 'manifests' );
}

export function getStoreTmpDirectory( siteId: string ): string {
	return path.join( getCheckpointStoreDirectory( siteId ), 'tmp' );
}

function getIndexPath( siteId: string ): string {
	return path.join( getCheckpointStoreDirectory( siteId ), 'index.json' );
}

function getStoreLockPath( siteId: string ): string {
	return path.join( getCheckpointStoreDirectory( siteId ), 'checkpoints.lock' );
}

export function getRestoreJournalPath( siteId: string ): string {
	return path.join( getCheckpointStoreDirectory( siteId ), 'restore-journal.json' );
}

export async function ensureStoreDirectories( siteId: string ): Promise< void > {
	await fsPromises.mkdir( getObjectsDirectory( siteId ), { recursive: true } );
	await fsPromises.mkdir( getManifestsDirectory( siteId ), { recursive: true } );
	await fsPromises.mkdir( getStoreTmpDirectory( siteId ), { recursive: true } );
}

// The store lock guards metadata mutations only (index read-modify-write,
// pin/unpin, prune) — always sub-second critical sections. The `lockfile`
// package steals locks held longer than LOCKFILE_STALE_TIME (5s), so long
// work (walking, hashing, object writes) must run lock-free; that's safe
// because objects are immutable and a checkpoint only exists once its index
// entry lands.
async function withStoreLock< T >( siteId: string, fn: () => Promise< T > ): Promise< T > {
	await lockFileAsync( getStoreLockPath( siteId ), {
		wait: LOCKFILE_WAIT_TIME,
		stale: LOCKFILE_STALE_TIME,
	} );
	try {
		return await fn();
	} finally {
		await unlockFileAsync( getStoreLockPath( siteId ) );
	}
}

export async function readCheckpointIndex( siteId: string ): Promise< CheckpointIndex > {
	const indexPath = getIndexPath( siteId );
	if ( ! fs.existsSync( indexPath ) ) {
		return { version: CHECKPOINT_STORE_VERSION, checkpoints: [] };
	}
	const raw = JSON.parse( await fsPromises.readFile( indexPath, 'utf8' ) );
	if ( typeof raw?.version === 'number' && raw.version > CHECKPOINT_STORE_VERSION ) {
		throw new Error(
			sprintf(
				__(
					'The checkpoint store for this site was created by a newer version of Studio (format v%d). Update Studio to use it.'
				),
				raw.version
			)
		);
	}
	return checkpointIndexSchema.parse( raw );
}

// Read-modify-write the index under the store lock.
export async function updateCheckpointIndex(
	siteId: string,
	mutate: ( index: CheckpointIndex ) => CheckpointIndex | Promise< CheckpointIndex >
): Promise< CheckpointIndex > {
	return withStoreLock( siteId, async () => {
		const index = await readCheckpointIndex( siteId );
		const updated = await mutate( index );
		await writeFile( getIndexPath( siteId ), JSON.stringify( updated, null, '\t' ) );
		return updated;
	} );
}

export function getManifestPath( siteId: string, checkpointId: string ): string {
	return path.join( getManifestsDirectory( siteId ), `${ checkpointId }.json` );
}

export async function readCheckpointManifest(
	siteId: string,
	checkpointId: string
): Promise< CheckpointManifest > {
	const manifestPath = getManifestPath( siteId, checkpointId );
	if ( ! fs.existsSync( manifestPath ) ) {
		throw new Error( sprintf( __( 'Checkpoint not found: %s' ), checkpointId ) );
	}
	const raw = JSON.parse( await fsPromises.readFile( manifestPath, 'utf8' ) );
	if ( typeof raw?.version === 'number' && raw.version > CHECKPOINT_STORE_VERSION ) {
		throw new Error(
			sprintf(
				__( 'Checkpoint %s was created by a newer version of Studio. Update Studio to use it.' ),
				checkpointId
			)
		);
	}
	return checkpointManifestSchema.parse( raw );
}

export async function writeCheckpointManifest( manifest: CheckpointManifest ): Promise< void > {
	await writeFile(
		getManifestPath( manifest.siteId, manifest.id ),
		JSON.stringify( manifest, null, '\t' )
	);
}

export async function readRestoreJournal( siteId: string ): Promise< RestoreJournal | undefined > {
	const journalPath = getRestoreJournalPath( siteId );
	if ( ! fs.existsSync( journalPath ) ) {
		return undefined;
	}
	try {
		return restoreJournalSchema.parse(
			JSON.parse( await fsPromises.readFile( journalPath, 'utf8' ) )
		);
	} catch ( error ) {
		return undefined;
	}
}

export async function writeRestoreJournal(
	siteId: string,
	journal: RestoreJournal
): Promise< void > {
	await writeFile( getRestoreJournalPath( siteId ), JSON.stringify( journal, null, '\t' ) );
}

export async function removeRestoreJournal( siteId: string ): Promise< void > {
	await fsPromises.rm( getRestoreJournalPath( siteId ), { force: true } );
}

// Removes the whole per-site store. Called when the site itself is deleted.
export async function removeCheckpointStore( siteId: string ): Promise< void > {
	await fsPromises.rm( getCheckpointStoreDirectory( siteId ), { recursive: true, force: true } );
}
