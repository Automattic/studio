import { loadUserData, lockAppdata, saveUserData, unlockAppdata } from 'src/storage/user-data';
import type { AiSessionSummary } from '@studio/common/ai/sessions/types';
import type { AiSessionSitePlacement } from 'src/storage/storage-types';

export type { AiSessionSitePlacement };

export interface AiSessionPlacementUpdatedEvent {
	sessionId: string;
	placement: AiSessionSitePlacement;
}

export async function readAiSessionPlacements(): Promise<
	Record< string, AiSessionSitePlacement >
> {
	const userData = await loadUserData();
	return userData.aiSessionPlacements ?? {};
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
	try {
		await lockAppdata();
		const userData = await loadUserData();
		const nextPlacement: AiSessionSitePlacement = {
			kind: 'site',
			...placement,
		};
		await saveUserData( {
			...userData,
			aiSessionPlacements: {
				...( userData.aiSessionPlacements ?? {} ),
				[ sessionId ]: nextPlacement,
			},
		} );
		return nextPlacement;
	} finally {
		await unlockAppdata();
	}
}

export async function deleteAiSessionPlacement( sessionId: string ): Promise< void > {
	try {
		await lockAppdata();
		const userData = await loadUserData();
		if ( ! userData.aiSessionPlacements?.[ sessionId ] ) {
			return;
		}
		const { [ sessionId ]: _deleted, ...remainingPlacements } = userData.aiSessionPlacements;
		await saveUserData( {
			...userData,
			aiSessionPlacements:
				Object.keys( remainingPlacements ).length > 0 ? remainingPlacements : undefined,
		} );
	} finally {
		await unlockAppdata();
	}
}

export function hydrateAiSessionSummaryWithPlacement(
	summary: AiSessionSummary,
	placement?: AiSessionSitePlacement
): AiSessionSummary {
	if ( ! placement ) {
		return {
			...summary,
			ownerSitePath: undefined,
			ownerSiteName: undefined,
		};
	}

	return {
		...summary,
		ownerSitePath: placement.sitePath,
		ownerSiteName: placement.siteName,
	};
}
