import { type Snapshot } from '@studio/common/types/snapshot';
import { __ } from '@wordpress/i18n';
import { LoggerError } from 'cli/logger';
import { lockCliConfig, readCliConfig, saveCliConfig, unlockCliConfig } from './core';
import { getSiteByFolder } from './sites';

export function getNextSnapshotSequence(
	siteId: string,
	snapshots: Snapshot[],
	userId: number
): number {
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
	name: string
): Promise< Snapshot > {
	const site = await getSiteByFolder( siteFolder );
	try {
		await lockCliConfig();
		const config = await readCliConfig();

		const nextSequenceNumber = getNextSnapshotSequence( site.id, config.snapshots, userId );
		const snapshot: Snapshot = {
			url: previewUrl,
			atomicSiteId,
			localSiteId: site.id,
			date: Date.now(),
			name,
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
	const site = await getSiteByFolder( siteFolder );
	try {
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

export async function deleteAllSnapshotsForUserFromConfig( userId: number ): Promise< void > {
	try {
		await lockCliConfig();
		const config = await readCliConfig();
		const filtered = config.snapshots.filter( ( s ) => s.userId !== userId );
		if ( filtered.length === config.snapshots.length ) {
			return;
		}
		config.snapshots = filtered;
		await saveCliConfig( config );
	} finally {
		await unlockCliConfig();
	}
}

export async function pruneExpiredOrphanedSnapshots(
	userId: number,
	isExpired: ( snapshot: Snapshot ) => boolean
): Promise< number > {
	try {
		await lockCliConfig();
		const config = await readCliConfig();
		const siteIds = new Set( config.sites.map( ( s ) => s.id ) );
		const filtered = config.snapshots.filter( ( snapshot ) => {
			if ( snapshot.userId !== userId ) {
				return true;
			}
			if ( siteIds.has( snapshot.localSiteId ) ) {
				return true;
			}
			return ! isExpired( snapshot );
		} );
		const pruned = config.snapshots.length - filtered.length;
		if ( pruned > 0 ) {
			config.snapshots = filtered;
			await saveCliConfig( config );
		}
		return pruned;
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
