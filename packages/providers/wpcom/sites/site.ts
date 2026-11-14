import { __ } from '@wordpress/i18n';
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
export function withWpcomDetails< Connection extends SyncSite >(
	connections: Connection[],
	wpcomSites: SyncSite[]
): Connection[] {
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
			...connection,
			...site,
			localSiteId,
			syncSupport,
			lastPullTimestamp,
			lastPushTimestamp,
			launchAfterPush: connection.launchAfterPush,
		};
	} );
}

// Why a site can't be published to or pulled from, from what WordPress.com says about it.
export function wpcomSiteIssue( site: SyncSite, direction: 'push' | 'pull' ): string | null {
	switch ( site.syncSupport ) {
		case 'deleted':
			return __( 'This website has been deleted. Choose another website.' );
		case 'missing-permissions':
			return __( 'You need administrator access to publish or pull changes.' );
		case 'needs-upgrade':
			return __(
				'This website needs a hosting plan that supports publishing from WordPress Studio.'
			);
		case 'needs-transfer':
			return __( 'Finish activating hosting on WordPress.com before publishing.' );
		case 'unsupported':
			return __( 'Publishing and pulling require a supported WordPress.com or Pressable website.' );
		default:
			return direction === 'push' && site.pushNeedsUpgrade
				? __( 'This website needs a hosting plan that supports publishing from WordPress Studio.' )
				: null;
	}
}

function wpcomEnvironmentLabel( site: SyncSite ): string {
	const environment =
		site.isPressable &&
		( site.environmentType === 'staging' || site.environmentType === 'development' )
			? site.environmentType
			: site.isStaging
			? 'staging'
			: 'production';
	switch ( environment ) {
		case 'staging':
			return __( 'Staging' );
		case 'development':
			return __( 'Development' );
		default:
			return __( 'Production' );
	}
}

export function wpcomPushWarning( site: SyncSite, local: { multisite?: boolean } ): string | null {
	return local.multisite && ! site.isPressable
		? __( 'WordPress.com does not support multisite. Publishing this network may cause problems.' )
		: null;
}

// What WordPress.com says about a site, and its pages there. Pressable sites are managed on
// Pressable, so WordPress.com has no pages for them.
export function describeWpcomSite( site: SyncSite ): {
	details: { title: string; value: string }[];
	links: { title: string; url: string }[];
} {
	const details = [ { title: __( 'Environment' ), value: wpcomEnvironmentLabel( site ) } ];
	let hostname: string | undefined;
	try {
		hostname = site.isPressable ? undefined : new URL( site.url ).hostname;
	} catch {
		hostname = undefined;
	}
	if ( ! hostname ) {
		return { details, links: [] };
	}
	const dashboard = `https://my.wordpress.com/sites/${ hostname }`;
	return {
		details,
		links: [
			{ title: __( 'Domains' ), url: `${ dashboard }/domains` },
			{ title: __( 'Backups' ), url: `https://wordpress.com/backup/${ hostname }` },
			{ title: __( 'Manage on WordPress.com' ), url: dashboard },
		],
	};
}
