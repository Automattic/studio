import { updateSessionMetadata } from '@studio/common/lib/session-metadata';
import type { StudioChatArtifactData } from '@studio/agent/protocol/chat-artifacts';
import type { AiSessionSummary } from '@studio/agent/protocol/sessions/types';
import type { SessionPlacement } from '@studio/common/lib/config/schema';

/**
 * AI session "placement": the local site a session created or owns, kept with the session's
 * metadata in the config file.
 */

export type AiSessionSitePlacement = SessionPlacement;

export interface AiSessionPlacementUpdatedEvent {
	sessionId: string;
	placement: AiSessionSitePlacement;
}

export async function setAiSessionSitePlacement(
	sessionId: string,
	placement: Omit< AiSessionSitePlacement, 'kind' >
): Promise< AiSessionSitePlacement > {
	const nextPlacement: AiSessionSitePlacement = { kind: 'site', ...placement };
	await updateSessionMetadata( sessionId, { placement: nextPlacement } );
	return nextPlacement;
}

export function hydrateAiSessionSummaryWithPlacement(
	summary: AiSessionSummary,
	placement?: AiSessionSitePlacement
): AiSessionSummary {
	if ( ! placement ) {
		return {
			...summary,
			ownerSiteId: undefined,
			ownerSitePath: undefined,
			ownerSiteName: undefined,
		};
	}
	return {
		...summary,
		ownerSiteId: placement.siteId,
		ownerSitePath: placement.sitePath,
		ownerSiteName: placement.siteName,
	};
}

// Extracts a created-site placement from a `chat.artifact` event, if the agent
// emitted a site-preview widget for a site it just created.
export function getCreatedSiteFromArtifact(
	artifact: StudioChatArtifactData
): Omit< AiSessionSitePlacement, 'kind' > | undefined {
	for ( const widget of artifact.widgets ) {
		if ( widget.type !== 'site-preview' ) {
			continue;
		}
		const { siteId, sitePath, siteName } = widget.widgetProps;
		if (
			typeof siteId === 'string' &&
			typeof sitePath === 'string' &&
			typeof siteName === 'string'
		) {
			return { siteId, sitePath, siteName };
		}
	}
	return undefined;
}
