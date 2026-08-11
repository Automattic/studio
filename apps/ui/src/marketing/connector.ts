import { createLocalConnector } from '@/data/core/connectors/local';
import {
	AGENT_COMPLETE_SESSION_ID,
	getMarketingSession,
	getMarketingSessions,
	getMarketingSites,
	MERIDIAN_THUMBNAIL,
	PRIMARY_SITE_ID,
	PRIMARY_SITE_STORAGE,
} from './fixtures';
import type { MarketingScenario, MarketingTheme } from './scenarios';
import type {
	AiSessionSummary,
	AppUpdateStatus,
	Connector,
	OnboardingHintsState,
	SiteDetails,
	UserPreferences,
} from '@/data/core';

const noopUnsubscribe = () => () => {};

function cloneSite( site: SiteDetails ): SiteDetails {
	return {
		...site,
		themeDetails: site.themeDetails ? { ...site.themeDetails } : undefined,
	};
}

/**
 * Return a complete Connector whose data is fully deterministic and whose
 * unsupported methods fail closed. The local connector supplies the complete
 * interface shape, but no local connector method can run unless it is
 * explicitly overridden below; this keeps screenshot capture independent of
 * a Studio server, WordPress.com account, or the developer's personal sites.
 */
export function createMarketingConnector(
	scenario: MarketingScenario,
	theme: MarketingTheme
): Connector {
	const localConnector = createLocalConnector( { apiBaseUrl: 'http://127.0.0.1:0' } );
	const sites = scenario.id === 'add-site' ? [] : getMarketingSites();
	const primarySite = sites.find( ( site ) => site.id === PRIMARY_SITE_ID );
	if ( primarySite ) {
		primarySite.running = true;
		primarySite.customDomain = undefined;
		primarySite.enableHttps = false;
		primarySite.url = window.location.origin;
	}
	const sessions =
		scenario.id === 'agent-complete-preview'
			? getMarketingSessions()
			: ( [] as AiSessionSummary[] );

	const preferences: UserPreferences = {
		editor: 'cursor',
		terminal: 'terminal',
		colorScheme: theme,
		quitSitesBehavior: 'stop-and-auto-start',
		locale: 'en',
		analyticsEnabled: false,
		defaultSiteDirectory: '/Studio',
		studioCliInstalled: true,
		studioCliExternallyManaged: false,
		agenticFeaturesEnabled: true,
	};
	const onboardingHints: OnboardingHintsState = {
		tourCompletedVersion: 999,
		tourDismissedVersion: 999,
		migratedFromClassic: false,
	};
	const updateStatus: AppUpdateStatus = { readyToInstall: false, version: null };

	const overrides: Partial< Connector > = {
		async init() {},
		capabilities: {
			nativeFolderPicker: false,
			nativeSaveDialog: false,
			openInOS: true,
			annotatePreview: false,
			readLocalMedia: false,
			agentInstructions: true,
			studioLogs: false,
			switchToClassicUi: false,
		},
		requiresAuth: false,
		agenticRequiresAuth: false,
		showsAppMenuButton: false,
		reservesTrafficLightSpace: true,

		async isAuthenticated() {
			return false;
		},
		async getAuthUser() {
			return null;
		},
		onAuthStateChanged: noopUnsubscribe,
		async getOnboardingCompleted() {
			return true;
		},
		async setOnboardingCompleted() {},
		async getOnboardingHints() {
			return { ...onboardingHints };
		},
		async setOnboardingHints( partial ) {
			Object.assign( onboardingHints, partial );
		},

		async getSites() {
			return sites.map( cloneSite );
		},
		async getSiteThumbnail( siteId ) {
			return siteId === PRIMARY_SITE_ID ? MERIDIAN_THUMBNAIL : null;
		},
		async getSiteStorageUsage( siteId ) {
			return siteId === PRIMARY_SITE_ID ? { ...PRIMARY_SITE_STORAGE } : null;
		},
		async getWpVersion() {
			return '6.8.2';
		},
		async getWordPressVersions() {
			return [
				{
					label: '6.8',
					value: 'latest',
					isBeta: false,
					isDevelopment: false,
				},
				{
					label: '6.8.2',
					value: '6.8.2',
					isBeta: false,
					isDevelopment: false,
				},
			];
		},
		async getConnectedWpcomSites() {
			return [];
		},
		async getSnapshots() {
			return [];
		},
		async getSnapshotUsage() {
			return { siteCount: 0, siteLimit: 5, siteCreationBlocked: false };
		},
		async getStudioAssistantQuota() {
			return null;
		},

		async getSessions() {
			return sessions.map( ( session ) => ( { ...session } ) );
		},
		async getSession( sessionId ) {
			return getMarketingSession( sessionId );
		},
		async createSession( siteId ) {
			const existing = sessions.find( ( session ) => session.ownerSiteId === siteId );
			return existing
				? { ...existing }
				: {
						id: AGENT_COMPLETE_SESSION_ID,
						filePath: '/marketing/sessions/agent-complete.jsonl',
						createdAt: '2026-08-08T14:00:00.000Z',
						updatedAt: '2026-08-08T14:04:00.000Z',
						ownerSiteId: siteId,
						activeEnvironment: 'local',
						eventCount: 0,
				  };
		},
		async getActiveAgentRuns() {
			return [];
		},
		onAgentEvent: noopUnsubscribe,
		onSessionPlacementUpdated: noopUnsubscribe,
		async getUserPreferences() {
			return { ...preferences };
		},
		async setUserPreferences( partial ) {
			Object.assign( preferences, partial );
		},
		async getInstalledApps() {
			return {
				antigravity: false,
				cursor: true,
				vscode: true,
				phpstorm: false,
				windsurf: false,
				webstorm: false,
				sublime: false,
				zed: false,
				terminal: true,
				iterm: false,
				warp: false,
				ghostty: false,
			};
		},
		async getAppGlobals() {
			return { platform: 'darwin', isWindowsStore: false, appVersion: '2.0.0' };
		},
		async getAgentInstructions() {
			return '';
		},
		async getWordPressSkillsStatusAllSites() {
			return [];
		},
		async getLastSeenVersion() {
			return '2.0.0';
		},
		async saveLastSeenVersion() {},
		async getAppUpdateStatus() {
			return { ...updateStatus };
		},
		onAppUpdateStatusChanged: noopUnsubscribe,

		async trackEvent() {},
		async openExternalUrl() {},
		async openSiteUrl() {},
		async openSiteFolder() {},
		async openSiteInEditor() {},
		async openSiteInTerminal() {},
		async popupAppMenu() {},
		async copyText() {},
		async isFullscreen() {
			return false;
		},
		onFullscreenChange: noopUnsubscribe,
		onSiteEvent: noopUnsubscribe,
		onToggleSitePreview: noopUnsubscribe,
		onToggleSidebar: noopUnsubscribe,
		onAddSite: noopUnsubscribe,
		onAddSiteWithBlueprint: noopUnsubscribe,
		onOpenSettings: noopUnsubscribe,
		onSyncConnectSite: noopUnsubscribe,
		onShowGettingStarted: noopUnsubscribe,
		onShowWhatsNew: noopUnsubscribe,
	};

	return new Proxy( localConnector, {
		get( target, property, receiver ) {
			if ( Object.prototype.hasOwnProperty.call( overrides, property ) ) {
				return Reflect.get( overrides, property, receiver );
			}
			const value = Reflect.get( target, property, receiver );
			if ( typeof value !== 'function' ) {
				return value;
			}
			return () => {
				throw new Error(
					`Connector method "${ String(
						property
					) }" is unavailable in marketing screenshot scenarios.`
				);
			};
		},
	} );
}
