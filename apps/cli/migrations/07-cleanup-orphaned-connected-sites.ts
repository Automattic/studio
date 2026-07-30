import {
	lockSharedConfig,
	readSharedConfig,
	saveSharedConfig,
	unlockSharedConfig,
} from '@studio/common/lib/shared-config';
import { readCliConfig } from 'cli/lib/cli-config/core';
import type { Migration } from '@studio/common/lib/migration';
import type { SharedConfig } from '@studio/common/lib/shared-config';

function hasOrphanedConnections( config: SharedConfig, localSiteIds: Set< string > ): boolean {
	return Object.values( config.connectedWpcomSites ?? {} ).some( ( connections ) =>
		connections.some( ( connection ) => ! localSiteIds.has( connection.localSiteId ) )
	);
}

async function getLocalSiteIds(): Promise< Set< string > > {
	return new Set( ( await readCliConfig() ).sites.map( ( site ) => site.id ) );
}

export const cleanupOrphanedConnectedSites: Migration = {
	async needsToRun() {
		const [ config, localSiteIds ] = await Promise.all( [ readSharedConfig(), getLocalSiteIds() ] );
		return hasOrphanedConnections( config, localSiteIds );
	},

	async run() {
		try {
			await lockSharedConfig();
			const config = await readSharedConfig();
			const localSiteIds = await getLocalSiteIds();
			if ( ! hasOrphanedConnections( config, localSiteIds ) ) {
				return;
			}

			for ( const [ userId, connections ] of Object.entries( config.connectedWpcomSites ?? {} ) ) {
				const validConnections = connections.filter( ( connection ) =>
					localSiteIds.has( connection.localSiteId )
				);
				if ( validConnections.length > 0 ) {
					config.connectedWpcomSites![ userId ] = validConnections;
				} else {
					delete config.connectedWpcomSites![ userId ];
				}
			}
			if ( config.connectedWpcomSites && Object.keys( config.connectedWpcomSites ).length === 0 ) {
				delete config.connectedWpcomSites;
			}
			await saveSharedConfig( config );
		} finally {
			await unlockSharedConfig();
		}
	},
};
