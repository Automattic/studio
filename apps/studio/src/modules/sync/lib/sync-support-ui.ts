import { __ } from '@wordpress/i18n';
import type { SyncSite } from '@studio/common/types/sync';

export const getSyncSupportActionUrl = ( site: SyncSite ) => {
	if ( site.syncSupport === 'needs-upgrade' ) {
		return `https://wordpress.com/plans/${ site.id }`;
	}

	if ( site.syncSupport === 'needs-transfer' ) {
		return `https://wordpress.com/hosting-features/${ site.id }`;
	}

	return undefined;
};

export const getSyncSupportActionLabel = ( site: SyncSite ) => {
	if ( site.syncSupport === 'needs-upgrade' ) {
		return __( 'Upgrade plan' );
	}

	if ( site.syncSupport === 'needs-transfer' ) {
		return __( 'Enable' );
	}

	return undefined;
};

export const getSyncSupportTitle = ( site: SyncSite ) => {
	switch ( site.syncSupport ) {
		case 'syncable':
			return __( 'Ready to sync' );
		case 'already-connected':
			return __( 'Already connected' );
		case 'needs-transfer':
			return __( 'Enable hosting features first' );
		case 'needs-upgrade':
			return __( 'Upgrade your plan to sync' );
		case 'missing-permissions':
			return __( 'Missing permissions' );
		case 'deleted':
			return __( 'Deleted' );
		case 'unsupported':
		default:
			return __( 'Not available for sync' );
	}
};

export const getSyncSupportDescription = ( site: SyncSite ) => {
	switch ( site.syncSupport ) {
		case 'syncable':
			return __( 'Create a local copy of this site.' );
		case 'already-connected':
			return __(
				'This site is already linked to a local site, but Studio could not resolve it in this workspace. Refresh sites and try again.'
			);
		case 'needs-transfer':
			return __(
				'These sites need hosting features turned on before they can sync. You can do this from WordPress.com.'
			);
		case 'needs-upgrade':
			return __(
				'Syncing requires a Business plan or higher. Upgrade on WordPress.com to get started.'
			);
		case 'missing-permissions':
			return __( 'Your WordPress.com user needs admin access to sync this site.' );
		case 'deleted':
			return __( 'This site has been deleted and cannot be synced.' );
		case 'unsupported':
		default:
			return __( "This site can't be synced due to missing permissions or other limitations." );
	}
};

export const canCreateLocalSiteFromRemote = ( site?: SyncSite ) => site?.syncSupport === 'syncable';
