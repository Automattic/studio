export { createMarketingConnector } from './connector';
export { applyMarketingPanelLayout, resolveMarketingPanelLayout } from './panel-layout';
export {
	DEFAULT_MARKETING_SCENARIO_ID,
	MARKETING_SCENARIOS,
	MARKETING_SCENARIO_IDS,
	getMarketingScenario,
	isMarketingScenarioId,
} from './scenarios';
export type {
	MarketingScenario,
	MarketingScenarioId,
	MarketingPanelLayout,
	MarketingPreviewState,
	MarketingSidebarState,
	MarketingTheme,
	MarketingViewport,
} from './scenarios';
export type { AppliedMarketingPanelLayout } from './panel-layout';
