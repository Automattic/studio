import { readAppConfig, updateAppConfig } from '@studio/common/lib/app-config';
import type { StudioChatArtifactData } from '@studio/common/ai/chat-artifacts';
import type { AiSessionSummary } from '@studio/common/ai/sessions/types';

/**
 * AI session "placement" — which local site a session created/owns. Stored in
 * `app.json` under `aiSessionPlacements` via the shared {@link updateAppConfig}
 * accessor; reads/writes touch only that key and preserve every other field.
 */

export interface AiSessionSitePlacement {
	kind: 'site';
	siteId: string;
	sitePath: string;
	siteName: string;
}

export interface AiSessionPlacementUpdatedEvent {
	sessionId: string;
	placement: AiSessionSitePlacement;
}

type SessionPlacements = Record< string, AiSessionSitePlacement >;

export async function readAiSessionPlacements(): Promise< SessionPlacements > {
	const config = await readAppConfig();
	return ( config.aiSessionPlacements as SessionPlacements | undefined ) ?? {};
}

export async function readAiSessionPlacement(
	sessionId: string
): Promise< AiSessionSitePlacement | undefined > {
	const placements = await readAiSessionPlacements();
	return placements[ sessionId ];
}

export async function setAiSessionSitePlacement(
	sessionId: string,
	placement: Omit< AiSessionSitePlacement, 'kind' >
): Promise< AiSessionSitePlacement > {
	return updateAppConfig( ( config ) => {
		const placements = ( config.aiSessionPlacements as SessionPlacements | undefined ) ?? {};
		const nextPlacement: AiSessionSitePlacement = { kind: 'site', ...placement };
		config.aiSessionPlacements = { ...placements, [ sessionId ]: nextPlacement };
		return nextPlacement;
	} );
}

export async function deleteAiSessionPlacement( sessionId: string ): Promise< void > {
	await updateAppConfig( ( config ) => {
		const placements = config.aiSessionPlacements as SessionPlacements | undefined;
		if ( ! placements?.[ sessionId ] ) {
			return;
		}
		const { [ sessionId ]: _deleted, ...remaining } = placements;
		config.aiSessionPlacements = Object.keys( remaining ).length > 0 ? remaining : undefined;
	} );
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
