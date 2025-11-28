import type { SyncSupport } from 'src/modules/sync/types';
import type { SitesEndpointSite } from 'src/stores/sync/wpcom-sites';

const STUDIO_SYNC_FEATURE_NAME = 'studio-sync';

export function isPressableSite( site: SitesEndpointSite ): boolean {
	return site.hosting_provider_guess === 'pressable';
}

export function isAtomicSite( site: SitesEndpointSite ): boolean {
	return site.is_wpcom_atomic;
}

export function hasSupportedPlan( site: SitesEndpointSite ): boolean {
	return site.plan?.features.active.includes( STUDIO_SYNC_FEATURE_NAME ) ?? false;
}

export function isJetpackSite( site: SitesEndpointSite ): boolean {
	return !! site.jetpack && ! isAtomicSite( site ) && ! isPressableSite( site );
}

export function needsTransfer( site: SitesEndpointSite ): boolean {
	return ! isJetpackSite( site ) && ! isPressableSite( site ) && ! isAtomicSite( site );
}

export function getSyncSupport( site: SitesEndpointSite, connectedSiteIds: number[] ): SyncSupport {
	if ( site.is_deleted ) {
		return 'deleted';
	}
	if ( ! site.capabilities?.manage_options ) {
		return 'missing-permissions';
	}
	if ( isJetpackSite( site ) ) {
		return 'unsupported';
	}
	if ( ! hasSupportedPlan( site ) && ! isPressableSite( site ) ) {
		return 'needs-upgrade';
	}
	if ( needsTransfer( site ) ) {
		return 'needs-transfer';
	}
	if ( connectedSiteIds.some( ( id ) => id === site.ID ) ) {
		return 'already-connected';
	}
	return 'syncable';
}
