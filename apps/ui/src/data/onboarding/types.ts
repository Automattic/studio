import type { ReactNode } from 'react';

// Stable ids for the DOM targets a coachmark can point at. Components register
// their element under one of these via useTourAnchor(); checklist and event
// coachmarks reference them by id so the two sides never drift.
export type CoachmarkAnchorId =
	| 'composer'
	| 'sidebar-site-row-overview'
	| 'site-overview-content'
	| 'site-settings-tab'
	| 'sidebar-user-menu'
	| 'publish-button';

export interface CoachmarkPlacement {
	side: 'top' | 'right' | 'bottom' | 'left';
	align: 'start' | 'center' | 'end';
}

// One coachmark bubble. title/description are functions so __() resolves at
// render time (locale switches, test i18n) rather than at module load.
export interface CoachmarkContent {
	anchor: CoachmarkAnchorId;
	title: () => string;
	description: () => ReactNode;
	placement: CoachmarkPlacement;
}
