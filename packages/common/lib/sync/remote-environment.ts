import { __, sprintf } from '@wordpress/i18n';
import type { SyncSite } from '@studio/common/types/sync';

export function formatRemoteEnvironment(
	site: Pick< SyncSite, 'isStaging' | 'environmentType' >
): string {
	return sprintf(
		/* translators: %s: JSON containing the remote site's isStaging and environmentType fields. */
		__( 'Remote environment: %s' ),
		JSON.stringify( {
			isStaging: site.isStaging,
			environmentType: site.environmentType ?? null,
		} )
	);
}
