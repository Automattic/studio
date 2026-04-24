import type { SitesEndpointSite, SyncSupport } from '@studio/common/types/sync';

const STUDIO_SYNC_FEATURE_NAME = 'studio-sync';

export function isPressableSite( site: SitesEndpointSite ): boolean {
	return site.hosting_provider_guess === 'pressable';
}

function isAtomicSite( site: SitesEndpointSite ): boolean {
	return site.is_wpcom_atomic;
}

function hasSupportedPlan( site: SitesEndpointSite ): boolean {
	return site.plan?.features.active.includes( STUDIO_SYNC_FEATURE_NAME ) ?? false;
}

// Sites hosted outside wp.com and Pressable (e.g. jurassic.ninja).
function isUnsupported( site: SitesEndpointSite ): boolean {
	return !! site.jetpack && ! isAtomicSite( site );
}

// needsTransfer means that the site was reverted to "simple" via "bulk-delete-test-sites" tool.
// Activating e.g. "VaultPress Backup" or "Hosting features" returns "is_wpcom_atomic === true && jetpack === true".
function needsTransfer( site: SitesEndpointSite ): boolean {
	return ! site.jetpack && ! isAtomicSite( site );
}

export function getSyncSupport( site: SitesEndpointSite, connectedSiteIds: number[] ): SyncSupport {
	if ( site.is_deleted ) {
		return 'deleted';
	}
	if ( ! site.capabilities?.manage_options ) {
		return 'missing-permissions';
	}
	if ( isUnsupported( site ) && ! isPressableSite( site ) ) {
		return 'unsupported';
	}
	if ( ! hasSupportedPlan( site ) && ! isPressableSite( site ) ) {
		return 'needs-upgrade';
	}
	if ( needsTransfer( site ) && ! isPressableSite( site ) ) {
		return 'needs-transfer';
	}
	if ( connectedSiteIds.some( ( id ) => id === site.ID ) ) {
		return 'already-connected';
	}

	return 'syncable';
}
