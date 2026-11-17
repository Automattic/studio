import { __, sprintf } from '@wordpress/i18n';
import type { SyncSite } from '@studio/common/types/sync';
import type { RemoteSite } from '@studio/providers';

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

export function withRemoteEnvironment(
	message: string,
	site: Pick< RemoteSite, 'name' | 'url' > &
		Partial< Pick< SyncSite, 'isStaging' | 'environmentType' > >
): string {
	if ( 'isStaging' in site && typeof site.isStaging === 'boolean' ) {
		const environmentType = 'environmentType' in site ? site.environmentType : null;
		return `${ message }\n${ formatRemoteEnvironment( {
			isStaging: site.isStaging,
			environmentType: typeof environmentType === 'string' ? environmentType : null,
		} ) }`;
	}
	return message;
}
