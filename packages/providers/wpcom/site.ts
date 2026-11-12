import { z } from 'zod';

// Whether a WordPress.com site can sync with a local site, and why not.
export const syncSupportValues = [
	'unsupported',
	'syncable',
	'needs-transfer',
	'already-connected',
	'needs-upgrade',
	'deleted',
	'missing-permissions',
] as const;

export type SyncSupport = ( typeof syncSupportValues )[ number ];

// A WordPress.com or Pressable site a local site syncs with.
export const syncSiteSchema = z.object( {
	id: z.number(),
	localSiteId: z.string(),
	name: z.string(),
	url: z.string(),
	isStaging: z.boolean(),
	isPressable: z.boolean(),
	environmentType: z.string().nullable().optional(),
	syncSupport: z.enum( syncSupportValues ),
	lastPullTimestamp: z.string().nullable(),
	lastPushTimestamp: z.string().nullable(),
	wpVersion: z.string().optional(),
	planName: z.string().optional(),
	pushNeedsUpgrade: z.boolean().optional(),
	createdAt: z.string().optional(),
	launchAfterPush: z.boolean().optional(),
} );

export type SyncSite = z.infer< typeof syncSiteSchema >;

// What a push or pull includes.
export const syncOptionSchema = z.enum( [
	'all',
	'sqls',
	'paths',
	'uploads',
	'plugins',
	'themes',
	'contents',
] );
export type SyncOption = z.infer< typeof syncOptionSchema >;

// Push selects local paths (relative, e.g. "wp-content/plugins/foo").
export type PushSyncOptions = {
	optionsToSync?: SyncOption[];
	specificSelectionPaths?: string[];
	launchAfterPush?: boolean;
};
/**
 * What a pull includes. By default, all files and the database. A pick of files is sent both as
 * Backup node ids for the Jetpack Backup pull and as paths for the Reprint pull
 * (`STUDIO_ENABLE_PULL_REPRINT`).
 */
export type PullSyncOptions = {
	optionsToSync?: SyncOption[];
	/** Backup node ids, used with the `paths` option. */
	includePathList?: string[];
	/** The same picks as paths relative to wp-content, such as `plugins/akismet`. */
	onlyPaths?: string[];
};

/**
 * Fills stored connections in from the account's current site list: only the link and the sync
 * times are read from storage. A connection missing from the list was deleted, or the user lost
 * access to it.
 */
export function withWpcomDetails( connections: SyncSite[], wpcomSites: SyncSite[] ): SyncSite[] {
	return connections.map( ( connection ) => {
		const { id, localSiteId, lastPullTimestamp, lastPushTimestamp } = connection;
		const site = wpcomSites.find( ( candidate ) => candidate.id === id );
		const syncSupport = ! site
			? 'deleted'
			: site.syncSupport === 'syncable'
			? 'already-connected'
			: site.syncSupport;
		return {
			// A site gone from WordPress.com keeps the name and URL it was connected under.
			...( site ?? connection ),
			localSiteId,
			syncSupport,
			lastPullTimestamp,
			lastPushTimestamp,
			launchAfterPush: connection.launchAfterPush,
		};
	} );
}
