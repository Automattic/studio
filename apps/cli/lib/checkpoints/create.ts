import crypto from 'crypto';
import fsPromises from 'fs/promises';
import { CheckpointEvents } from '@studio/common/lib/checkpoint-events';
import { __ } from '@wordpress/i18n';
import { getWordPressVersionFromInstallation } from 'cli/lib/dependency-management/wordpress';
import { isServerRunning } from 'cli/lib/wordpress-server-manager';
import { captureDatabase } from './capture-database';
import { CheckpointEventEmitter } from './events';
import {
	ensureStoreDirectories,
	readCheckpointIndex,
	readCheckpointManifest,
	updateCheckpointIndex,
	writeCheckpointManifest,
	getManifestPath,
	CHECKPOINT_STORE_VERSION,
	type CheckpointManifest,
	type CheckpointTrigger,
	type ManifestFileEntry,
} from './manifest';
import {
	DEFAULT_RETENTION_POLICY,
	selectPrunableCheckpoints,
	type RetentionPolicy,
} from './retention';
import { collectGarbage, collectReferencedHashes, writeObject } from './store';
import { canReusePreviousEntry, walkSite } from './walker';
import type { SiteData } from 'cli/lib/cli-config/core';

// Objects younger than this are never garbage collected, so an in-flight
// create in another process can't have its freshly written objects swept
// before its manifest lands.
export const GC_GRACE_MS = 30 * 60 * 1000;

export interface CreateCheckpointOptions {
	label?: string;
	trigger?: CheckpointTrigger;
	agentRunId?: string;
	toolName?: string;
	retentionPolicy?: RetentionPolicy;
	emitter?: CheckpointEventEmitter;
	// Skip pruning/GC — used by the safety checkpoint inside restore, which
	// must not sweep objects mid-restore.
	skipMaintenance?: boolean;
}

export function isCheckpointSupported( site: SiteData ): boolean {
	// Reprint-pulled sites wire SQLite through runtime.php and ship no db.php
	// drop-in; their runtime wiring lives outside the standard site layout, so
	// checkpoints don't support them yet.
	return ! site.runtimeBlueprintPath;
}

export async function createCheckpoint(
	site: SiteData,
	options: CreateCheckpointOptions = {}
): Promise< CheckpointManifest > {
	const emitter = options.emitter ?? new CheckpointEventEmitter();
	const trigger = options.trigger ?? 'manual';

	if ( ! isCheckpointSupported( site ) ) {
		throw new Error(
			__( 'Checkpoints are not yet supported for sites imported with `studio pull-reprint`.' )
		);
	}

	await ensureStoreDirectories( site.id );
	emitter.emit( CheckpointEvents.CHECKPOINT_CREATE_START, { siteId: site.id } );

	try {
		const index = await readCheckpointIndex( site.id );
		const previousEntry = index.checkpoints[ index.checkpoints.length - 1 ];
		const previousManifest = previousEntry
			? await readCheckpointManifest( site.id, previousEntry.id ).catch( () => undefined )
			: undefined;

		const isRunning = !! ( await isServerRunning( site.id ) );

		// Capture the database first so its snapshot is closest to the moment
		// the checkpoint was requested; file churn during a running capture is
		// accepted best-effort.
		emitter.emit( CheckpointEvents.CHECKPOINT_CREATE_PROGRESS, { phase: 'database' } );
		const dbCapture = await captureDatabase( site, isRunning );

		let newObjectBytes = 0;
		let dbRef;
		try {
			dbRef = await writeObject( site.id, dbCapture.capturedPath, { compress: true } );
			newObjectBytes += dbRef.size;
		} finally {
			await fsPromises.rm( dbCapture.capturedPath, { force: true } );
		}

		emitter.emit( CheckpointEvents.CHECKPOINT_CREATE_PROGRESS, { phase: 'files' } );
		const walk = await walkSite( site.path );

		const files: Record< string, ManifestFileEntry > = {};
		let logicalBytes = 0;
		let processed = 0;

		for ( const file of walk.files ) {
			logicalBytes += file.size;
			const reusable = canReusePreviousEntry( file, previousManifest );
			if ( reusable ) {
				files[ file.relPath ] = {
					...reusable,
					mode: file.mode,
					mtimeMs: file.mtimeMs,
					logicalSize: file.size,
				};
			} else {
				try {
					const ref = await writeObject( site.id, file.fullPath );
					newObjectBytes += ref.size;
					files[ file.relPath ] = {
						...ref,
						mode: file.mode,
						mtimeMs: file.mtimeMs,
						logicalSize: file.size,
					};
				} catch ( error ) {
					// The file disappeared mid-capture (running site); skip it.
				}
			}

			processed++;
			if ( processed % 500 === 0 ) {
				emitter.emit( CheckpointEvents.CHECKPOINT_CREATE_PROGRESS, {
					phase: 'files',
					processed,
					total: walk.files.length,
				} );
			}
		}

		for ( const symlink of walk.symlinks ) {
			files[ symlink.relPath ] = { symlink: symlink.target };
		}

		emitter.emit( CheckpointEvents.CHECKPOINT_CREATE_PROGRESS, { phase: 'finalizing' } );

		const wpVersion = await getWordPressVersionFromInstallation( site.path ).catch(
			() => undefined
		);

		const manifest: CheckpointManifest = {
			version: CHECKPOINT_STORE_VERSION,
			id: `cp-${ Date.now() }-${ crypto.randomUUID().slice( 0, 8 ) }`,
			siteId: site.id,
			label: options.label,
			createdAt: Date.now(),
			trigger,
			agentRunId: options.agentRunId,
			toolName: options.toolName,
			phpVersion: site.phpVersion,
			wpVersion: wpVersion || undefined,
			db: { ...dbRef, capture: dbCapture.capture },
			files,
			stats: {
				fileCount: walk.files.length,
				logicalBytes,
				newObjectBytes,
			},
		};

		await writeCheckpointManifest( manifest );

		// The checkpoint exists once its index entry lands (under the store
		// lock). Prune decisions happen in the same critical section.
		let pruned: string[] = [];
		await updateCheckpointIndex( site.id, ( current ) => {
			current.checkpoints.push( {
				id: manifest.id,
				label: manifest.label,
				createdAt: manifest.createdAt,
				trigger: manifest.trigger,
				toolName: manifest.toolName,
				stats: manifest.stats,
			} );
			if ( ! options.skipMaintenance ) {
				const prunable = selectPrunableCheckpoints(
					current,
					options.retentionPolicy ?? DEFAULT_RETENTION_POLICY
				);
				pruned = prunable.map( ( entry ) => entry.id );
				current.checkpoints = current.checkpoints.filter(
					( entry ) => ! pruned.includes( entry.id )
				);
			}
			return current;
		} );

		for ( const prunedId of pruned ) {
			await fsPromises.rm( getManifestPath( site.id, prunedId ), { force: true } );
		}

		if ( ! options.skipMaintenance ) {
			await runGarbageCollection( site.id );
		}

		emitter.emit( CheckpointEvents.CHECKPOINT_CREATE_COMPLETE, {
			checkpointId: manifest.id,
			siteId: site.id,
		} );

		return manifest;
	} catch ( error ) {
		emitter.emit( CheckpointEvents.CHECKPOINT_CREATE_ERROR, {
			message: error instanceof Error ? error.message : String( error ),
		} );
		throw error;
	}
}

export async function runGarbageCollection( siteId: string ): Promise< number > {
	const index = await readCheckpointIndex( siteId );
	const manifests: CheckpointManifest[] = [];
	for ( const entry of index.checkpoints ) {
		const manifest = await readCheckpointManifest( siteId, entry.id ).catch( () => undefined );
		if ( manifest ) {
			manifests.push( manifest );
		}
	}
	return collectGarbage( siteId, collectReferencedHashes( manifests ), GC_GRACE_MS );
}
