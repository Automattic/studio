import { migrateConnectedSitesToSlots } from '@studio/common/lib/sync/slot-migration';
import { loadUserData, lockAppdata, saveUserData, unlockAppdata } from 'src/storage/user-data';
import type { Migration } from '@studio/common/lib/migration';
import type { SyncSite } from '@studio/common/types/sync';

declare module 'src/storage/user-data' {
	interface UserData {
		migrations?: {
			slotMigration_v1?: boolean;
		};
	}
}

export const archiveExcessConnectedSites: Migration = {
	async needsToRun() {
		const userData = await loadUserData();
		if ( ( userData as any ).migrations?.slotMigration_v1 ) {
			return false;
		}
		const connected = userData.connectedWpcomSites;
		if ( ! connected ) {
			return false;
		}
		for ( const userId of Object.keys( connected ) ) {
			const list = connected[ Number( userId ) ];
			if ( ! Array.isArray( list ) ) continue;
			// Group by localSiteId; if any group has >2 entries we need to run.
			const byLocal = new Map< string, number >();
			for ( const s of list ) {
				byLocal.set( s.localSiteId, ( byLocal.get( s.localSiteId ) ?? 0 ) + 1 );
			}
			for ( const count of byLocal.values() ) {
				if ( count > 2 ) return true;
			}
		}
		return true; // mark as run even when nothing to archive, to set the flag
	},
	async run() {
		try {
			await lockAppdata();
			const userData = await loadUserData();
			if ( userData.connectedWpcomSites ) {
				for ( const userId of Object.keys( userData.connectedWpcomSites ) ) {
					const key = Number( userId );
					const list: SyncSite[] | undefined = userData.connectedWpcomSites[ key ];
					if ( ! Array.isArray( list ) ) continue;
					// Group by localSiteId, migrate each group, then flatten back.
					const byLocal = new Map< string, SyncSite[] >();
					for ( const s of list ) {
						const arr = byLocal.get( s.localSiteId ) ?? [];
						arr.push( s );
						byLocal.set( s.localSiteId, arr );
					}
					const next: SyncSite[] = [];
					for ( const arr of byLocal.values() ) {
						next.push( ...migrateConnectedSitesToSlots( arr ) );
					}
					userData.connectedWpcomSites[ key ] = next;
				}
			}
			( userData as any ).migrations = {
				...( userData as any ).migrations,
				slotMigration_v1: true,
			};
			await saveUserData( userData );
		} finally {
			await unlockAppdata();
		}
	},
};
