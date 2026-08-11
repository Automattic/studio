export const DEFAULT_MARKETING_SCENARIO_ID = 'agent-complete-preview';

export type MarketingTheme = 'light' | 'dark';

export interface MarketingViewport {
	width: number;
	height: number;
	deviceScaleFactor: number;
}

export type MarketingSidebarState = 'expanded' | 'collapsed';
export type MarketingPreviewState = 'open' | 'closed';

export interface MarketingPanelLayout {
	sidebar: {
		state: MarketingSidebarState;
		width: number;
	};
	preview: {
		state: MarketingPreviewState;
		/** The preview's share of the content frame, from 0 to 1. */
		widthRatio: number;
	};
}

export interface MarketingScenario {
	id: MarketingScenarioId;
	title: string;
	description: string;
	route: string;
	preferredViewport: MarketingViewport;
	/** Initial panel state used by the marketing-only entry point. */
	panelLayout: MarketingPanelLayout;
	/**
	 * A selector for content that only appears once the scenario's primary UI
	 * has resolved. The marketing entry waits for this element to be visible,
	 * then waits for fonts and images before advertising screenshot readiness.
	 */
	readySelector: string;
}

const scenarioDefinitions = {
	'add-site': {
		title: 'Add a site',
		description: 'The site creation, connection, and import choices.',
		route: '/onboarding',
		preferredViewport: { width: 1440, height: 900, deviceScaleFactor: 2 },
		panelLayout: {
			sidebar: { state: 'expanded', width: 320 },
			preview: { state: 'closed', widthRatio: 0.5 },
		},
		readySelector: 'h1',
	},
	'site-overview': {
		title: 'Site overview',
		description: 'A local site overview with a deterministic site thumbnail and storage data.',
		route: '/sites/meridian/overview',
		preferredViewport: { width: 1440, height: 900, deviceScaleFactor: 2 },
		panelLayout: {
			sidebar: { state: 'expanded', width: 320 },
			preview: { state: 'open', widthRatio: 0.48 },
		},
		readySelector: 'button[aria-label="Open site in browser"]',
	},
	'agent-complete-preview': {
		title: 'Completed Studio Code task',
		description: 'A completed agent conversation shown beside the site preview.',
		route: '/sessions/marketing-agent-complete',
		preferredViewport: { width: 1600, height: 1000, deviceScaleFactor: 2 },
		panelLayout: {
			sidebar: { state: 'expanded', width: 320 },
			preview: { state: 'open', widthRatio: 0.55 },
		},
		readySelector: '[data-message-text]',
	},
} as const;

export type MarketingScenarioId = keyof typeof scenarioDefinitions;

export const MARKETING_SCENARIO_IDS = Object.freeze(
	Object.keys( scenarioDefinitions ) as MarketingScenarioId[]
);

export const MARKETING_SCENARIOS: Readonly< Record< MarketingScenarioId, MarketingScenario > > =
	Object.freeze(
		Object.fromEntries(
			MARKETING_SCENARIO_IDS.map( ( id ) => [
				id,
				Object.freeze( { id, ...scenarioDefinitions[ id ] } ),
			] )
		) as Record< MarketingScenarioId, MarketingScenario >
	);

export function isMarketingScenarioId( value: string ): value is MarketingScenarioId {
	return Object.prototype.hasOwnProperty.call( scenarioDefinitions, value );
}

export function getMarketingScenario( id: string ): MarketingScenario {
	if ( ! isMarketingScenarioId( id ) ) {
		throw new Error(
			`Unknown marketing screenshot scenario "${ id }". Expected one of: ${ MARKETING_SCENARIO_IDS.join(
				', '
			) }.`
		);
	}
	return MARKETING_SCENARIOS[ id ];
}
