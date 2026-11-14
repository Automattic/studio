import { __ } from '@wordpress/i18n';
import type { SyncSite } from '../types/sync';

/**
 * The connected sites a preview can show changes to: production sites that are not Pressable and
 * not known to need a plan to push. WordPress.com checks the plan itself and ignores a site that
 * doesn't qualify, so a stale or missing `pushNeedsUpgrade` is safe.
 */
export function getQualifyingLiveSites( sites: SyncSite[] ): SyncSite[] {
	return sites.filter(
		( site ) => ! site.isStaging && ! site.isPressable && site.pushNeedsUpgrade !== true
	);
}

/**
 * The live site a preview shows changes to. `selection` is a qualifying site's ID, or `none`; without
 * one, it is the only qualifying site, if there is just one.
 */
export function selectLiveSite( sites: SyncSite[], selection?: string ): SyncSite | undefined {
	const qualifying = getQualifyingLiveSites( sites );
	if ( selection === undefined ) return qualifying.length === 1 ? qualifying[ 0 ] : undefined;
	if ( selection === 'none' ) return undefined;
	const selected = qualifying.find( ( site ) => String( site.id ) === selection );
	if ( ! selected ) {
		throw new Error(
			__( 'The live site must be a qualifying connected site of this local site.' )
		);
	}
	return selected;
}
