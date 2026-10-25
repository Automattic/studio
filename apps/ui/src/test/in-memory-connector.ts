import { SITE_EVENTS } from '@studio/common/lib/cli-events';
import { SUPPORTED_EDITORS } from '@studio/common/lib/user-settings/editor';
import { SUPPORTED_TERMINALS } from '@studio/common/lib/user-settings/terminal';
import type {
	AiSessionSummary,
	AuthUser,
	Connector,
	InstalledApps,
	LoadedAiSession,
	SiteDetails,
	UserPreferences,
} from '@/data/core';

type Methods = {
	[ K in keyof Connector as Required< Connector >[ K ] extends ( ...args: never[] ) => unknown
		? K
		: never ]-?: Required< Connector >[ K ];
};
type Listener< K extends keyof Methods > = Parameters< Methods[ K ] >[ 0 ];
type EventName = {
	[ K in keyof Methods ]: K extends `on${ string }` ? K : never;
}[ keyof Methods ];

export type ConnectorMethods = Methods;

export type InMemoryConnector = Connector & {
	state: FakeConnectorState;
	emit< K extends EventName >( event: K, ...args: Parameters< Listener< K > > ): void;
	listenerCount( event: EventName ): number;
};

export interface FakeConnectorState {
	sites: SiteDetails[];
	sessions: LoadedAiSession[];
	user: AuthUser | null;
	preferences: UserPreferences;
}

export type FakeConnectorInitialState = Partial< Omit< FakeConnectorState, 'preferences' > > & {
	preferences?: Partial< UserPreferences >;
};

export function makeSite( overrides: Partial< SiteDetails > = {} ): SiteDetails {
	const id = overrides.id ?? 'site-1';
	return {
		id,
		name: 'My site',
		path: `/sites/${ id }`,
		port: 9010,
		phpVersion: '8.3',
		running: false,
		...overrides,
	};
}

export function makeSession( overrides: Partial< AiSessionSummary > = {} ): AiSessionSummary {
	const id = overrides.id ?? 'session-1';
	return {
		id,
		filePath: `/sessions/${ id }.jsonl`,
		createdAt: '2026-01-01T00:00:00.000Z',
		updatedAt: '2026-01-01T00:00:00.000Z',
		activeEnvironment: 'local',
		eventCount: 0,
		...overrides,
	};
}

// Shared across connectors so ids never repeat within a test file, where
// module-level stores keyed by id (composer drafts) outlive a render.
let nextId = 1;

export const TEST_USER: AuthUser = { id: 1, email: 'test@example.test', displayName: 'Test User' };

const defaultPreferences = (): UserPreferences => ( {
	editor: 'vscode',
	terminal: 'terminal',
	colorScheme: 'light',
	locale: 'en',
	analyticsEnabled: true,
	defaultSiteDirectory: '/sites',
	studioCliInstalled: false,
	studioCliExternallyManaged: false,
	agenticFeaturesEnabled: true,
	showRecentChats: true,
} );

const installedApps = () =>
	Object.fromEntries(
		[ ...SUPPORTED_EDITORS, ...SUPPORTED_TERMINALS ].map( ( app ) => [
			app,
			app === 'vscode' || app === 'terminal',
		] )
	) as InstalledApps;

/**
 * A `Connector` over in-memory state, for rendering real providers and
 * components without a host, in tests and dev pages alike. `emit` drives the
 * `on*` subscriptions the way the host would.
 */
export function createInMemoryConnector(
	initial: FakeConnectorInitialState = {},
	overrides: Partial< Connector > = {}
): InMemoryConnector {
	const state: FakeConnectorState = {
		sites: [],
		sessions: [],
		user: TEST_USER,
		...initial,
		preferences: { ...defaultPreferences(), ...initial.preferences },
	};
	type AnyListener = ( ...args: never[] ) => void;
	const listeners = new Map< string, Set< AnyListener > >();
	const subscribe = ( event: string ) => ( listener: AnyListener ) => {
		const set = listeners.get( event ) ?? new Set();
		set.add( listener );
		listeners.set( event, set );
		return () => {
			set.delete( listener );
		};
	};
	const findSession = ( id: string ) => {
		const session = state.sessions.find( ( entry ) => entry.summary.id === id );
		if ( ! session ) {
			throw new Error( `No session ${ id }` );
		}
		return session;
	};
	const emit = ( event: string, ...args: unknown[] ) => {
		for ( const listener of listeners.get( event ) ?? [] ) {
			( listener as ( ...values: unknown[] ) => void )( ...args );
		}
	};
	const emitSiteEvent = ( event: SITE_EVENTS, site: SiteDetails ) =>
		queueMicrotask( () =>
			emit( 'onSiteEvent', { event, siteId: site.id, running: site.running } )
		);
	const updateSite = ( id: string, patch: Partial< SiteDetails > ) => {
		state.sites = state.sites.map( ( site ) => ( site.id === id ? { ...site, ...patch } : site ) );
		const site = state.sites.find( ( entry ) => entry.id === id );
		if ( site ) {
			emitSiteEvent( SITE_EVENTS.UPDATED, site );
		}
	};
	let agentInstructions = '';
	let agentInstructionsEnabled = true;

	const methods: Methods = {
		init: async () => {},
		getAuthUser: async () => state.user,
		authenticate: async () => {
			state.user = TEST_USER;
		},
		logout: async () => {
			state.user = null;
		},
		onAuthStateChanged: subscribe( 'onAuthStateChanged' ),
		getOnboardingCompleted: async () => true,
		setOnboardingCompleted: async () => {},
		getSites: async () => state.sites,
		createSite: async ( params ) => {
			const site = makeSite( {
				id: `created-${ nextId++ }`,
				name: params.name,
				path: params.path,
				running: ! params.skipStart,
			} );
			state.sites = [ ...state.sites, site ];
			emitSiteEvent( SITE_EVENTS.CREATED, site );
			return site;
		},
		deleteSite: async ( id ) => {
			const site = state.sites.find( ( entry ) => entry.id === id );
			state.sites = state.sites.filter( ( entry ) => entry.id !== id );
			if ( site ) {
				emitSiteEvent( SITE_EVENTS.DELETED, { ...site, running: false } );
			}
		},
		copySite: async ( id ) => {
			const source = state.sites.find( ( site ) => site.id === id )!;
			const copy = { ...source, id: `copy-${ nextId++ }`, name: `${ source.name } Copy` };
			state.sites = [ ...state.sites, copy ];
			emitSiteEvent( SITE_EVENTS.CREATED, copy );
			return copy;
		},
		startSite: async ( id ) => updateSite( id, { running: true } ),
		stopSite: async ( id ) => updateSite( id, { running: false } ),
		updateSite: async ( site ) => updateSite( site.id, site ),
		updateSitesSortOrder: async ( updates ) => {
			for ( const { siteId, sortOrder } of updates ) {
				updateSite( siteId, { sortOrder } );
			}
		},
		getSiteThumbnail: async () => null,
		captureSitePreview: async () => null,
		getSiteIcon: async () => null,
		getSiteDesign: async () => null,
		fixSiteDesignDrift: async () => null,
		exportFullSite: async () => null,
		exportDatabase: async () => null,
		generateProposedSitePath: async ( name ) => ( {
			path: `/sites/${ name }`,
			isEmpty: true,
			isWordPress: false,
		} ),
		generateProposedSiteName: async () => 'My WordPress Website',
		generateNumberedSiteName: async ( name ) => name,
		selectSiteFolder: async () => null,
		comparePaths: async ( a, b ) => a === b,
		getWordPressVersions: async () => [],
		getWpVersion: async () => '6.9',
		getFilePath: async ( file ) => `/files/${ file.name }`,
		readLocalMediaFile: async ( path ) => ( {
			name: path,
			mimeType: 'image/png',
			data: new ArrayBuffer( 0 ),
		} ),
		extractBlueprintBundle: async () => {
			throw new Error( 'Not implemented in the fake connector' );
		},
		cleanupBlueprintTempDir: async () => {},
		readBlueprintFile: async () => ( {} ),
		importSiteFromBackup: async () => {},
		getSnapshots: async () => [],
		getSnapshotUsage: async () => null,
		getStudioAssistantQuota: async () => null,
		getStudioAssistantTopUpPricing: async () => null,
		deleteAllSnapshots: async () => {},
		confirmDeleteAllPreviewSites: async () => true,
		publishPreviewSite: async () => ( { url: 'preview.example.com' } ),
		deleteSnapshot: async () => {},
		renameSnapshot: async () => {},
		getConnectedWpcomSites: async () => [],
		fetchSyncableWpcomSites: async () => [],
		connectWpcomSite: async () => {},
		disconnectWpcomSite: async () => {},
		pushSiteToLive: async () => {},
		pullSiteFromLive: async () => {},
		onSyncActivity: subscribe( 'onSyncActivity' ),
		cancelSync: async () => {},
		getLatestRewindId: async () => null,
		listRemoteFileTree: async () => ( {} ),
		getHostingPhpVersion: async () => undefined,
		listLocalFileTree: async () => [],
		getDirectorySize: async () => 0,
		getFileSize: async () => 0,
		getIsMultisite: async () => undefined,
		getPublishCheckoutUrl: () => undefined,
		onSyncConnectSite: subscribe( 'onSyncConnectSite' ),
		watchForPublishedSite: async () => {},
		getSessions: async () => state.sessions.map( ( session ) => session.summary ),
		getSession: async ( id ) => findSession( id ),
		updateSessionMetadata: async ( id, patch ) => {
			const session = findSession( id );
			session.summary = { ...session.summary, ...patch };
			return session.summary;
		},
		createSession: async ( siteId ) => {
			const site = state.sites.find( ( entry ) => entry.id === siteId );
			const summary = makeSession( {
				id: `session-${ nextId++ }`,
				ownerSiteId: site?.id,
				ownerSitePath: site?.path,
				ownerSiteName: site?.name,
			} );
			state.sessions = [ ...state.sessions, { summary, entries: [] } ];
			return summary;
		},
		continueSession: async () => ( { runId: `run-${ nextId++ }` } ),
		getActiveAgentRuns: async () => [],
		setSessionModel: async () => {},
		setSessionProvider: async () => {},
		setSessionEnvironment: async ( id, environment ) => {
			const session = findSession( id );
			session.summary = { ...session.summary, activeEnvironment: environment };
		},
		interruptAgentRun: async () => {},
		answerAgentQuestion: async () => {},
		onAgentEvent: subscribe( 'onAgentEvent' ),
		onConnectionRestored: subscribe( 'onConnectionRestored' ),
		onSessionPlacementUpdated: subscribe( 'onSessionPlacementUpdated' ),
		getUserPreferences: async () => state.preferences,
		setUserPreferences: async ( partial ) => {
			state.preferences = { ...state.preferences, ...partial };
		},
		selectDefaultSiteDirectory: async () => null,
		isCertificateTrusted: async () => false,
		trustCertificate: async () => {},
		getAgentInstructions: async () => agentInstructions,
		getAgentInstructionsEnabled: async () => agentInstructionsEnabled,
		setAgentInstructionsEnabled: async ( enabled ) => {
			agentInstructionsEnabled = enabled;
		},
		saveAgentInstructions: async ( content ) => {
			agentInstructions = content;
		},
		getAiSettings: async () => ( {
			provider: 'wpcom',
			hasAnthropicApiKey: false,
			anthropicApiKeyPreview: null,
		} ),
		saveAnthropicApiKey: async ( key ) => ( {
			provider: 'wpcom',
			hasAnthropicApiKey: !! key,
			anthropicApiKeyPreview: key ? 'sk-ant-…test' : null,
		} ),
		setAiProvider: async ( provider ) => ( {
			provider,
			hasAnthropicApiKey: false,
			anthropicApiKeyPreview: null,
		} ),
		getInstalledApps: async () => installedApps(),
		getAppGlobals: async () => ( { platform: 'darwin', isWindowsStore: false } ),
		fetchSiteRest: async () => ( {
			status: 200,
			statusText: 'OK',
			headers: {},
			body: '',
			url: '',
		} ),
		openSiteFolder: async () => {},
		openSiteInEditor: async () => {},
		openSiteInTerminal: async () => {},
		siteDebugLogExists: async () => false,
		openSiteDebugLog: async () => {},
		openStudioLogs: async () => {},
		trackEvent: async () => {},
		openExternalUrl: async () => {},
		getWapuuScore: async () => undefined,
		saveWapuuScore: async () => {},
		popupAppMenu: async () => {},
		getWordPressSkillsStatusAllSites: async () => [],
		installWordPressSkillToAllSites: async () => {},
		removeWordPressSkillFromAllSites: async () => {},
		getSiteAgentFiles: async () => [],
		setSiteAgentFileEnabled: async () => {},
		removeSiteAgentFile: async () => {},
		openSiteAgentFile: async () => {},
		copyText: async () => {},
		showTextContextMenu: async () => undefined,
		openSiteUrl: async () => {},
		setWindowControlsSurface: async () => {},
		isFullscreen: async () => false,
		onFullscreenChange: subscribe( 'onFullscreenChange' ),
		onSiteEvent: subscribe( 'onSiteEvent' ),
		onSnapshotEvent: subscribe( 'onSnapshotEvent' ),
		onToggleSitePreview: subscribe( 'onToggleSitePreview' ),
		onToggleSidebar: subscribe( 'onToggleSidebar' ),
		onAddSite: subscribe( 'onAddSite' ),
		onAddSiteWithBlueprint: subscribe( 'onAddSiteWithBlueprint' ),
		onOpenSettings: subscribe( 'onOpenSettings' ),
		onAiCreditsPurchased: subscribe( 'onAiCreditsPurchased' ),
		getOnboardingHints: async () => ( {
			tourDismissedVersion: Number.MAX_SAFE_INTEGER,
			whatsNewSeenVersion: Number.MAX_SAFE_INTEGER,
		} ),
		setOnboardingHints: async () => {},
		onShowGettingStarted: subscribe( 'onShowGettingStarted' ),
		onShowWhatsNew: subscribe( 'onShowWhatsNew' ),
		getAppUpdateStatus: async () => ( { state: 'idle', currentVersion: null } ),
		installAppUpdate: async () => {},
		onAppUpdateStatusChanged: subscribe( 'onAppUpdateStatusChanged' ),
		onAppUpdateNotAvailable: subscribe( 'onAppUpdateNotAvailable' ),
	};

	return {
		capabilities: {
			nativeFolderPicker: true,
			annotatePreview: true,
			studioLogs: true,
		},
		agenticRequiresAuth: true,
		showsAppMenuButton: false,
		reservesTrafficLightSpace: false,
		...methods,
		...overrides,
		state,
		emit,
		listenerCount: ( event ) => listeners.get( event )?.size ?? 0,
	} as InMemoryConnector;
}
