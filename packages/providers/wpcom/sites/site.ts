import { __ } from '@wordpress/i18n';
import { z } from 'zod';
import type { SiteLink } from '../../types';

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
	hasPaidPlan: z.boolean().optional(),
	pushNeedsUpgrade: z.boolean().optional(),
	createdAt: z.string().optional(),
	launchAfterPush: z.boolean().optional(),
	localVersionId: z.string().nullable().optional(),
	launchStatus: z.string().optional(),
	visibility: z.enum( [ 'private', 'coming-soon', 'public' ] ).optional(),
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
			url: site && URL.canParse( site.url ) ? site.url : connection.url,
			localSiteId,
			syncSupport,
			lastPullTimestamp,
			lastPushTimestamp,
			launchAfterPush: connection.launchAfterPush,
			localVersionId: connection.localVersionId,
		};
	} );
}

const publishingNeedsUpgrade = () => __( 'Publishing requires a supported plan.' );

// Why a site can't be published to or pulled from, from what WordPress.com says about it.
export function wpcomSiteIssue( site: SyncSite, direction: 'push' | 'pull' ): string | null {
	switch ( site.syncSupport ) {
		case 'deleted':
			return __( 'This website has been deleted. Choose another website.' );
		case 'missing-permissions':
			return __( 'You need administrator access to publish or pull changes.' );
		case 'needs-upgrade':
			if ( direction === 'pull' )
				return __(
					'This website needs a hosting plan that supports pulling into WordPress Studio.'
				);
			return publishingNeedsUpgrade();
		case 'needs-transfer':
			return direction === 'pull'
				? __( 'Finish activating hosting on WordPress.com before pulling.' )
				: __( 'Finish activating hosting on WordPress.com before publishing.' );
		case 'unsupported':
			return __( 'Publishing and pulling require a supported WordPress.com or Pressable website.' );
		default:
			return direction === 'push' && site.pushNeedsUpgrade ? publishingNeedsUpgrade() : null;
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

export function describeWpcomSite( site: SyncSite ) {
	return {
		details: [ { title: __( 'Environment' ), value: wpcomEnvironmentLabel( site ) } ],
		links: wpcomSiteLinks( site ),
	};
}

const GLOBE_ICON =
	'<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 256 256" fill="currentColor"><path d="M128,24h0A104,104,0,1,0,232,128,104.12,104.12,0,0,0,128,24Zm87.62,96H175.79C174,83.49,159.94,57.67,148.41,42.4A88.19,88.19,0,0,1,215.63,120ZM96.23,136h63.54c-2.31,41.61-22.23,67.11-31.77,77C118.45,203.1,98.54,177.6,96.23,136Zm0-16C98.54,78.39,118.46,52.89,128,43c9.55,9.93,29.46,35.43,31.77,77Zm11.36-77.6C96.06,57.67,82,83.49,80.21,120H40.37A88.19,88.19,0,0,1,107.59,42.4ZM40.37,136H80.21c1.82,36.51,15.85,62.33,27.38,77.6A88.19,88.19,0,0,1,40.37,136Zm108,77.6c11.53-15.27,25.56-41.09,27.38-77.6h39.84A88.19,88.19,0,0,1,148.41,213.6Z"/></svg>';

function wpcomSiteLinks( site: SyncSite ): SiteLink[] {
	if ( site.isPressable || ! URL.canParse( site.url ) ) return [];
	const hostname = new URL( site.url ).hostname;
	const dashboard = `https://my.wordpress.com/sites/${ hostname }`;
	return [
		{ title: __( 'Manage on WordPress.com' ), url: dashboard },
		{ title: __( 'Manage domains' ), url: `${ dashboard }/domains`, icon: GLOBE_ICON },
		{ title: __( 'View backups' ), url: `https://wordpress.com/backup/${ hostname }` },
	];
}

export function wpcomVisibilityLink( site: SyncSite ): SiteLink | undefined {
	return site.isPressable || ! URL.canParse( site.url )
		? undefined
		: {
				title: __( 'Manage on WordPress.com' ),
				url: `https://wordpress.com/settings/general/${ site.id }`,
		  };
}

// Where the site's paid plan is managed; undefined without one.
export function wpcomPlanUrl( site: SyncSite ): string | undefined {
	return site.hasPaidPlan === true && ! site.isPressable && URL.canParse( site.url )
		? `https://wordpress.com/plans/my-plan/${ new URL( site.url ).hostname }`
		: undefined;
}
