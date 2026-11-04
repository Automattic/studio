import {
	TRACKS_EVENTS,
	type TracksEventName,
	type TracksProps,
} from '@studio/common/lib/record-tracks-event';
import { getSiteTracksProps } from '@studio/common/lib/site-tracks';
import { loadHydratedAiSession } from '@studio/agent/node/sessions/manage';
import { MAX_VISUAL_ANNOTATIONS } from '@studio/agent/protocol/visual-annotations';

export async function recordAnnotationSubmitted( options: {
	annotationCount: number;
	sessionsRoot: string;
	sessionId: string;
	record?: ( event: TracksEventName, props: TracksProps ) => Promise< void >;
} ): Promise< void > {
	const { annotationCount, sessionsRoot, sessionId, record } = options;
	if ( ! record || annotationCount <= 0 ) {
		return;
	}
	try {
		let siteProps: TracksProps = {};
		try {
			const { summary } = await loadHydratedAiSession( sessionsRoot, sessionId );
			if ( summary.ownerSiteId ) {
				siteProps = await getSiteTracksProps( { siteId: summary.ownerSiteId } );
			} else if ( summary.ownerSitePath ) {
				siteProps = await getSiteTracksProps( { siteFolder: summary.ownerSitePath } );
			}
		} catch {
			// Missing session/site metadata must not suppress the submission event.
		}
		await record( TRACKS_EVENTS.ANNOTATION_SUBMITTED, {
			annotation_count: Math.min( annotationCount, MAX_VISUAL_ANNOTATIONS ),
			...siteProps,
		} );
	} catch {
		// Analytics must not affect sending a chat turn.
	}
}
