import type { ReactNode } from 'react';

// Stable ids for the DOM targets a coachmark can point at. Components register
// their element under one of these via useTourAnchor(); tours and checklist
// coachmarks reference them by id so the two sides never drift.
export type CoachmarkAnchorId =
	| 'sidebar-site-list'
	| 'sidebar-site-row-overview'
	| 'sidebar-create-site'
	| 'sidebar-user-menu'
	| 'composer'
	| 'preview-pane'
	| 'site-overview-content'
	| 'site-settings-tab'
	| 'site-menu-button'
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

export type TourStep = CoachmarkContent;

export interface TourDefinition {
	id: 'orientation-agentic' | 'orientation-overview';
	// Bump when the tour content changes enough to re-show to everyone who
	// already completed the previous version.
	version: number;
	steps: TourStep[];
}
