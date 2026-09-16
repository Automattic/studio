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
			preview: { state: 'open', widthRatio: 0.6 },
		},
		readySelector: 'button[aria-label="Open site in browser"]',
	},
	'site-portfolio': {
		title: 'Multi-site portfolio',
		description: 'A busy local site portfolio with a focused site overview.',
		route: '/sites/meridian/overview',
		preferredViewport: { width: 1440, height: 900, deviceScaleFactor: 2 },
		panelLayout: {
			sidebar: { state: 'expanded', width: 300 },
			preview: { state: 'closed', widthRatio: 0.6 },
		},
		readySelector: 'button[aria-label="Open site in browser"]',
	},
	'agent-new-session': {
		title: 'Start a Studio Code task',
		description: 'A new Studio Code conversation with suggested tasks for an existing site.',
		route: '/sessions/marketing-agent-new',
		preferredViewport: { width: 1440, height: 900, deviceScaleFactor: 2 },
		panelLayout: {
			sidebar: { state: 'expanded', width: 300 },
			preview: { state: 'closed', widthRatio: 0.6 },
		},
		readySelector: '[data-session-composer]',
	},
	'agent-working-preview': {
		title: 'Studio Code working',
		description: 'An active Studio Code task shown beside the site preview.',
		route: '/sessions/marketing-agent-working',
		preferredViewport: { width: 1600, height: 1000, deviceScaleFactor: 2 },
		panelLayout: {
			sidebar: { state: 'expanded', width: 300 },
			preview: { state: 'open', widthRatio: 0.6 },
		},
		readySelector: '[role="status"][aria-label="Working…"]',
	},
	'agent-complete-preview': {
		title: 'Completed Studio Code task',
		description: 'A completed agent conversation shown beside the site preview.',
		route: '/sessions/marketing-agent-complete',
		preferredViewport: { width: 1600, height: 1000, deviceScaleFactor: 2 },
		panelLayout: {
			sidebar: { state: 'collapsed', width: 300 },
			preview: { state: 'open', widthRatio: 0.6 },
		},
		readySelector: '[data-message-text]',
	},
	'agent-long-conversation': {
		title: 'Long Studio Code conversation',
		description: 'A multi-turn Studio Code conversation without the sidebar or site preview.',
		route: '/sessions/marketing-agent-long',
		preferredViewport: { width: 1440, height: 900, deviceScaleFactor: 2 },
		panelLayout: {
			sidebar: { state: 'collapsed', width: 300 },
			preview: { state: 'closed', widthRatio: 0.6 },
		},
		readySelector: '[data-message-text]',
	},
	'connected-site-controls': {
		title: 'Connected site controls',
		description: 'Local, preview, and connected Pressable environments for a site.',
		route: '/sites/meridian/overview?sync=pull',
		preferredViewport: { width: 1440, height: 900, deviceScaleFactor: 2 },
		panelLayout: {
			sidebar: { state: 'expanded', width: 300 },
			preview: { state: 'closed', widthRatio: 0.6 },
		},
		readySelector: 'button[aria-label="Pull from live"]',
	},
	'selective-sync': {
		title: 'Selective pull from Pressable',
		description: 'A selective sync dialog for pulling content from a connected Pressable site.',
		route: '/sites/meridian/overview?sync=pull',
		preferredViewport: { width: 1440, height: 900, deviceScaleFactor: 2 },
		panelLayout: {
			sidebar: { state: 'expanded', width: 300 },
			preview: { state: 'closed', widthRatio: 0.6 },
		},
		readySelector: 'button[aria-label="Pull from live"]',
	},
	'responsive-preview': {
		title: 'Responsive site preview',
		description: 'A full-screen desktop and mobile preview of the local site.',
		route: '/sites/meridian/overview',
		preferredViewport: { width: 1920, height: 1080, deviceScaleFactor: 2 },
		panelLayout: {
			sidebar: { state: 'expanded', width: 300 },
			preview: { state: 'open', widthRatio: 0.6 },
		},
		readySelector: '[aria-label="Site preview"] iframe',
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
