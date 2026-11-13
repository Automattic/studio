import { __, sprintf } from '@wordpress/i18n';
import { previewExpiry } from '@/features/sharing';
import { PublishedTime } from './published-time';
import type { PublishTarget } from './use-publish-targets';

export function describePublishTarget(
	{ snapshot, remote, provider }: PublishTarget,
	locale: string | undefined,
	targets: PublishTarget[]
) {
	if ( snapshot ) {
		const live = snapshot.liveSiteId
			? targets.find(
					( target ) => target.provider === provider && target.remote?.id === snapshot.liveSiteId
			  )?.remote
			: undefined;
		const expiry = previewExpiry( snapshot, locale, { month: 'short', day: 'numeric' } );
		return live
			? `${ sprintf( __( 'Changes to %s' ), live.name || live.url ) } · ${ expiry }`
			: expiry;
	}

	if ( remote?.lastPushTimestamp ) {
		return <PublishedTime timestamp={ remote.lastPushTimestamp } />;
	}

	return remote?.lastPushTimestamp === null ? __( 'Not published yet' ) : undefined;
}
