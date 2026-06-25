// AI session placement now lives in `@studio/common` so the desktop app and the
// `studio ui` server record and read it identically (app.json, coordinated by
// the same lockfile). This module is a re-export kept so existing desktop
// imports (`src/lib/ai-session-placement`) keep resolving.
export {
	readAiSessionPlacements,
	readAiSessionPlacement,
	setAiSessionSitePlacement,
	deleteAiSessionPlacement,
	hydrateAiSessionSummaryWithPlacement,
	type AiSessionSitePlacement,
	type AiSessionPlacementUpdatedEvent,
} from '@studio/common/ai/sessions/placement';
