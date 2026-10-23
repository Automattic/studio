import { type SiteOperationKind } from '@studio/common/lib/site-operation';
import { getSiteOperationLabel } from '@studio/common/lib/site-operation-labels';
import { __ } from '@wordpress/i18n';
import type { SiteDetails } from '@/data/core';

// `starting`/`stopping` and `operation` overlap but neither covers the other:
// the first two are this window's in-flight mutations, which land the moment
// the user clicks, while `operation` is what the CLI recorded — a round-trip
// later, but the only one that sees work the agent or another window started.
type SiteStatusInput = {
	running: boolean;
	starting: boolean;
	stopping: boolean;
	operation: SiteOperationKind | null;
};

export function getSiteStatus(
	site: SiteDetails,
	starting: boolean,
	stopping: boolean,
	operation: SiteOperationKind | null
): 'running' | 'stopped' | 'transitioning' {
	if ( operation || starting || stopping ) {
		return 'transitioning';
	}
	return site.running ? 'running' : 'stopped';
}

// Short status name for the status button's tooltip: "Running", "Stopping",
// "Saving settings".
export function getSiteStatusName( {
	running,
	starting,
	stopping,
	operation,
}: SiteStatusInput ): string {
	if ( operation ) {
		return getSiteOperationLabel( operation );
	}
	if ( stopping ) {
		return __( 'Stopping' );
	}
	if ( starting ) {
		return __( 'Starting' );
	}
	return running ? __( 'Running' ) : __( 'Stopped' );
}
