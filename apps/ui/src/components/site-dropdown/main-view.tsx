import { isSnapshotExpired } from '@studio/common/lib/snapshots';
import { useIsMutating, useQuery } from '@tanstack/react-query';
import { __, sprintf } from '@wordpress/i18n';
import { arrowUp, copy, external, Icon } from '@wordpress/icons';
import { Button, Field, IconButton, Select, Tooltip } from '@wordpress/ui';
import { clsx } from 'clsx';
import { useEffect, useMemo, useState } from 'react';
import { XdebugIcon } from '@/components/xdebug-icon';
import { useConnector } from '@/data/core';
import { useAgenticFeatures } from '@/data/queries/use-agentic-features';
import { useLogin } from '@/data/queries/use-auth-user';
import { useCheckpoints, useCreateCheckpoint } from '@/data/queries/use-checkpoints';
import { useConnectedWpcomSites } from '@/data/queries/use-connected-wpcom-sites';
import { usePublishPreviewSite } from '@/data/queries/use-preview-site';
import {
	useIsSiteStarting,
	useIsSiteStopping,
	useStartSite,
	useStopSite,
} from '@/data/queries/use-sites';
import { useSnapshots } from '@/data/queries/use-snapshots';
import {
	PULL_FROM_LIVE_MUTATION_KEY,
	PUSH_TO_LIVE_MUTATION_KEY,
	usePullSiteFromLive,
	usePushSiteToLive,
} from '@/data/queries/use-sync-site';
import { formatRelativeTime } from '@/lib/format-relative-time';
import { getSiteUrl } from '@/lib/get-site-url';
import styles from './main-view.module.css';
import { PopoverRow } from './popover-row';
import { getSyncActivityLabel } from './trigger-secondary';
import {
	deriveSiteStatus,
	ensureProtocol,
	getSnapshotHostname,
	pickLatestSnapshot,
	pickLiveSite,
	stripProtocol,
} from './utils';
import type { LiveSyncItem, LiveSyncItems, LiveSyncOptions, SiteDetails } from '@/data/core';
import type { SyncActivity, SyncLogEntry, SyncLogSummary } from '@/data/sync-activity';
import type { ComponentProps } from 'react';

type ButtonProps = ComponentProps< typeof Button >;
type SyncDirection = 'push' | 'pull';
type SyncUseCase =
	| 'everything'
	| 'database'
	| 'active-theme'
	| 'all-themes'
	| 'all-plugins'
	| 'customize';
type SyncCustomThemeSelection = 'none' | 'active-theme' | 'all-themes' | 'choose-themes';
type SyncCustomPluginSelection = 'none' | 'all-plugins' | 'choose-plugins';
type SyncCustomOptions = {
	database: boolean;
	uploads: boolean;
	themes: SyncCustomThemeSelection;
	plugins: SyncCustomPluginSelection;
};
type SyncSelectItem< Value extends string > = {
	value: Value;
	label: string;
};
type SyncSelectSize = ComponentProps< typeof Select.Trigger >[ 'size' ];

const EMPTY_SYNC_ITEMS: LiveSyncItems = {
	source: 'local',
	themes: [],
	plugins: [],
};

function getPreviewPanelCopy(
	agenticEnabled: boolean,
	isOffline: boolean,
	isPreviewExpired: boolean
): string {
	if ( agenticEnabled ) {
		return isPreviewExpired
			? __( 'The previous preview has expired.' )
			: __( 'Share a review link for this version.' );
	}
	return isOffline
		? __( 'Go online to share a review link.' )
		: __( 'Log in to share a review link.' );
}

function getLivePanelCopy( agenticEnabled: boolean, isOffline: boolean ): string {
	if ( agenticEnabled ) {
		return __( 'No connected site.' );
	}
	return isOffline ? __( 'Go online to publish your site.' ) : __( 'Log in to publish your site.' );
}

const DEFAULT_CUSTOM_SYNC_OPTIONS: SyncCustomOptions = {
	database: true,
	uploads: false,
	themes: 'none',
	plugins: 'none',
};

function getSyncUseCaseItems(): SyncSelectItem< SyncUseCase >[] {
	return [
		{ value: 'everything', label: __( 'Whole site' ) },
		{ value: 'database', label: __( 'Content and settings' ) },
		{ value: 'active-theme', label: __( 'Active theme' ) },
		{ value: 'all-themes', label: __( 'All themes' ) },
		{ value: 'all-plugins', label: __( 'All plugins' ) },
		{ value: 'customize', label: __( 'Customize...' ) },
	];
}

function getThemeSelectionItems(): SyncSelectItem< SyncCustomThemeSelection >[] {
	return [
		{ value: 'none', label: __( 'Do not sync' ) },
		{ value: 'active-theme', label: __( 'Active theme' ) },
		{ value: 'all-themes', label: __( 'All themes' ) },
		{ value: 'choose-themes', label: __( 'Choose themes' ) },
	];
}

function getPluginSelectionItems(): SyncSelectItem< SyncCustomPluginSelection >[] {
	return [
		{ value: 'none', label: __( 'Do not sync' ) },
		{ value: 'all-plugins', label: __( 'All plugins' ) },
		{ value: 'choose-plugins', label: __( 'Choose plugins' ) },
	];
}

function getSelectedSelectItem< Value extends string >(
	items: SyncSelectItem< Value >[],
	value: Value
): SyncSelectItem< Value > {
	return items.find( ( item ) => item.value === value ) ?? items[ 0 ];
}

type Props = {
	site: SiteDetails;
	activity: SyncActivity | null;
	lastSyncLog: SyncLogSummary | null;
	// Switches the dropdown to the publish picker. Lives in the parent because
	// the picker is a sibling view at the popup level.
	onSetupClick: () => void;
	onDisconnectClick: () => void;
};

// Counts in-flight push/pull mutations for this site across hook instances.
// Needed because the parent kicks off a push from the publish-picker flow via
// its own mutation instance — this component's Push button would otherwise
// report "idle" while the picker-initiated push is still running.
function useIsSiteSyncing( siteId: string ): { push: boolean; pull: boolean } {
	const push =
		useIsMutating( {
			mutationKey: PUSH_TO_LIVE_MUTATION_KEY,
			predicate: ( mutation ) =>
				( mutation.state.variables as { siteId: string } | undefined )?.siteId === siteId,
		} ) > 0;
	const pull =
		useIsMutating( {
			mutationKey: PULL_FROM_LIVE_MUTATION_KEY,
			predicate: ( mutation ) =>
				( mutation.state.variables as { siteId: string } | undefined )?.siteId === siteId,
		} ) > 0;
	return { push, pull };
}

function getSelectedItems( items: LiveSyncItem[], selectedPaths: string[] ): LiveSyncItem[] {
	const selectedPathSet = new Set( selectedPaths );
	return items.filter( ( item ) => selectedPathSet.has( item.path ) );
}

function getSelectedPathIds( items: LiveSyncItem[] ): string[] {
	return items.map( ( item ) => item.pathId ).filter( ( pathId ): pathId is string => !! pathId );
}

function getSpecificItemsSyncOptions( {
	direction,
	option,
	items,
}: {
	direction: SyncDirection;
	option: 'themes' | 'plugins';
	items: LiveSyncItem[];
} ): LiveSyncOptions {
	if ( direction === 'pull' ) {
		return {
			optionsToSync: items.length ? [ 'paths' ] : [],
			includePathList: getSelectedPathIds( items ),
		};
	}

	return {
		optionsToSync: items.length ? [ option ] : [],
		specificSelectionPaths: items.map( ( item ) => item.path ),
	};
}

function mergeSyncOptions( options: LiveSyncOptions[] ): LiveSyncOptions {
	const optionsToSync = [ ...new Set( options.flatMap( ( option ) => option.optionsToSync ) ) ];
	const specificSelectionPaths = [
		...new Set( options.flatMap( ( option ) => option.specificSelectionPaths ?? [] ) ),
	];
	const includePathList = [
		...new Set( options.flatMap( ( option ) => option.includePathList ?? [] ) ),
	];

	return {
		optionsToSync,
		specificSelectionPaths: specificSelectionPaths.length ? specificSelectionPaths : undefined,
		includePathList: includePathList.length ? includePathList : undefined,
	};
}

function getCustomSyncOptions( {
	direction,
	customOptions,
	items,
	activeThemePath,
	selectedThemePaths,
	selectedPluginPaths,
}: {
	direction: SyncDirection;
	customOptions: SyncCustomOptions;
	items: LiveSyncItems;
	activeThemePath?: string;
	selectedThemePaths: string[];
	selectedPluginPaths: string[];
} ): LiveSyncOptions {
	const selectedOptions: LiveSyncOptions[] = [];

	if ( customOptions.database ) {
		selectedOptions.push( { optionsToSync: [ 'sqls' ] } );
	}

	if ( customOptions.uploads ) {
		selectedOptions.push( { optionsToSync: [ 'uploads' ] } );
	}

	if ( customOptions.themes === 'all-themes' ) {
		selectedOptions.push( { optionsToSync: [ 'themes' ] } );
	} else if ( customOptions.themes === 'active-theme' ) {
		const selectedItems = activeThemePath
			? getSelectedItems( items.themes, [ activeThemePath ] )
			: [];
		selectedOptions.push(
			getSpecificItemsSyncOptions( { direction, option: 'themes', items: selectedItems } )
		);
	} else if ( customOptions.themes === 'choose-themes' ) {
		const selectedItems = getSelectedItems( items.themes, selectedThemePaths );
		selectedOptions.push(
			getSpecificItemsSyncOptions( { direction, option: 'themes', items: selectedItems } )
		);
	}

	if ( customOptions.plugins === 'all-plugins' ) {
		selectedOptions.push( { optionsToSync: [ 'plugins' ] } );
	} else if ( customOptions.plugins === 'choose-plugins' ) {
		const selectedItems = getSelectedItems( items.plugins, selectedPluginPaths );
		selectedOptions.push(
			getSpecificItemsSyncOptions( { direction, option: 'plugins', items: selectedItems } )
		);
	}

	return mergeSyncOptions( selectedOptions );
}

function getSyncOptions( {
	direction,
	useCase,
	items,
	activeThemePath,
	selectedThemePaths,
	selectedPluginPaths,
	customOptions,
}: {
	direction: SyncDirection;
	useCase: SyncUseCase;
	items: LiveSyncItems;
	activeThemePath?: string;
	selectedThemePaths: string[];
	selectedPluginPaths: string[];
	customOptions: SyncCustomOptions;
} ): LiveSyncOptions {
	switch ( useCase ) {
		case 'database':
			return { optionsToSync: [ 'sqls' ] };
		case 'all-themes':
			return { optionsToSync: [ 'themes' ] };
		case 'all-plugins':
			return { optionsToSync: [ 'plugins' ] };
		case 'active-theme': {
			const selectedItems = activeThemePath
				? getSelectedItems( items.themes, [ activeThemePath ] )
				: [];
			return getSpecificItemsSyncOptions( {
				direction,
				option: 'themes',
				items: selectedItems,
			} );
		}
		case 'customize':
			return getCustomSyncOptions( {
				direction,
				customOptions,
				items,
				activeThemePath,
				selectedThemePaths,
				selectedPluginPaths,
			} );
		case 'everything':
		default:
			return { optionsToSync: [ 'all' ] };
	}
}

function getActiveThemeItem( site: SiteDetails, themes: LiveSyncItem[] ): LiveSyncItem | undefined {
	const activeThemeNames = [
		site.themeDetails?.slug,
		site.themeDetails?.name,
		site.themeDetails?.path,
	].filter( ( activeThemeName ): activeThemeName is string => !! activeThemeName );

	return themes.find( ( theme ) =>
		activeThemeNames.some(
			( activeThemeName ) =>
				theme.name === activeThemeName ||
				theme.path === activeThemeName ||
				theme.path.endsWith( `/${ activeThemeName }` )
		)
	);
}

function pickInitialThemePath( site: SiteDetails, themes: LiveSyncItem[] ): string | undefined {
	return ( getActiveThemeItem( site, themes ) ?? themes[ 0 ] )?.path;
}

function getItemCountLabel( count: number, source: string, itemType: string ): string {
	return sprintf( __( '%1$d %2$s %3$s' ), count, source, itemType );
}

function getSelectedItemSummaryLabel( items: LiveSyncItem[], selectedPaths: string[] ): string {
	const selectedItems = getSelectedItems( items, selectedPaths );
	if ( selectedItems.length === 0 ) {
		return __( 'selected items' );
	}

	if ( selectedItems.length === 1 ) {
		return selectedItems[ 0 ].name;
	}

	return sprintf(
		// translators: %d: number of selected themes or plugins.
		__( '%d selected items' ),
		selectedItems.length
	);
}

function getCustomSyncSummary( {
	customOptions,
	items,
	activeThemeName,
	selectedThemePaths,
	selectedPluginPaths,
}: {
	customOptions: SyncCustomOptions;
	items: LiveSyncItems;
	activeThemeName?: string;
	selectedThemePaths: string[];
	selectedPluginPaths: string[];
} ): string {
	const selections: string[] = [];

	if ( customOptions.database ) {
		selections.push( __( 'content and settings' ) );
	}

	if ( customOptions.themes === 'active-theme' ) {
		selections.push(
			activeThemeName ? sprintf( __( 'active theme (%s)' ), activeThemeName ) : __( 'active theme' )
		);
	} else if ( customOptions.themes === 'all-themes' ) {
		selections.push( __( 'all themes' ) );
	} else if ( customOptions.themes === 'choose-themes' ) {
		selections.push(
			sprintf(
				// translators: %s: selected theme names or count.
				__( 'themes: %s' ),
				getSelectedItemSummaryLabel( items.themes, selectedThemePaths )
			)
		);
	}

	if ( customOptions.plugins === 'all-plugins' ) {
		selections.push( __( 'all plugins' ) );
	} else if ( customOptions.plugins === 'choose-plugins' ) {
		selections.push(
			sprintf(
				// translators: %s: selected plugin names or count.
				__( 'plugins: %s' ),
				getSelectedItemSummaryLabel( items.plugins, selectedPluginPaths )
			)
		);
	}

	if ( customOptions.uploads ) {
		selections.push( __( 'uploads' ) );
	}

	if ( selections.length === 0 ) {
		return __( 'Nothing selected yet.' );
	}

	return sprintf(
		// translators: %s: comma-separated list of selected sync areas.
		__( 'Syncing %s.' ),
		selections.join( ', ' )
	);
}

function isLiveSyncPending(
	activity: SyncActivity | null
): activity is Extract< SyncActivity, { kind: 'pending' } > {
	return (
		activity?.kind === 'pending' &&
		( activity.direction === 'push' || activity.direction === 'pull' )
	);
}

function getLatestBackupLabel( latestBackupTime: string | null | undefined ): string | null {
	if ( latestBackupTime === undefined ) {
		return null;
	}

	if ( latestBackupTime === null ) {
		return __( 'Latest live backup unavailable' );
	}

	const relativeTime = formatRelativeTime( latestBackupTime );
	if ( ! relativeTime ) {
		return null;
	}

	if ( relativeTime === __( 'now' ) ) {
		return __( 'Latest live backup: now' );
	}

	return sprintf(
		// translators: %s: compact relative time, e.g. "4m" or "2h".
		__( 'Latest live backup: %s ago' ),
		relativeTime
	);
}

function formatLogDuration(
	startTimestamp: string,
	endTimestamp: string | undefined,
	now: number
): string {
	const start = Date.parse( startTimestamp );
	if ( Number.isNaN( start ) ) {
		return '';
	}

	const parsedEnd = endTimestamp ? Date.parse( endTimestamp ) : now;
	const end = Number.isNaN( parsedEnd ) ? now : parsedEnd;
	const elapsedMs = Math.max( 0, end - start );
	const elapsedSeconds = Math.floor( elapsedMs / 1000 );

	if ( elapsedSeconds < 60 ) {
		return sprintf(
			// translators: %d: number of seconds.
			__( '%ds' ),
			elapsedSeconds
		);
	}

	const elapsedMinutes = Math.floor( elapsedSeconds / 60 );
	if ( elapsedMinutes < 60 ) {
		return sprintf(
			// translators: %d: number of minutes.
			__( '%dm' ),
			elapsedMinutes
		);
	}

	const elapsedHours = Math.floor( elapsedMinutes / 60 );
	if ( elapsedHours < 24 ) {
		return sprintf(
			// translators: %d: number of hours.
			__( '%dh' ),
			elapsedHours
		);
	}

	return sprintf(
		// translators: %d: number of days.
		__( '%dd' ),
		Math.floor( elapsedHours / 24 )
	);
}

function getSyncLogEntries( activity: SyncActivity | null ): SyncLogEntry[] {
	if ( activity?.log?.length ) {
		return activity.log;
	}

	if ( activity?.kind === 'pending' ) {
		return [
			{
				timestamp: new Date().toISOString(),
				message: getSyncActivityLabel( activity ),
			},
		];
	}

	return [];
}

function getLastSyncLogMeta( summary: SyncLogSummary ): string {
	const relativeTime = formatRelativeTime( summary.completedAt );
	if ( ! relativeTime ) {
		return summary.kind === 'success' ? __( 'Completed' ) : __( 'Failed' );
	}

	const suffix =
		relativeTime === __( 'now' )
			? relativeTime
			: sprintf(
					// translators: %s: compact relative time, e.g. "4m" or "2h".
					__( '%s ago' ),
					relativeTime
			  );

	return summary.kind === 'success'
		? sprintf(
				// translators: %s: relative time phrase.
				__( 'Completed %s' ),
				suffix
		  )
		: sprintf(
				// translators: %s: relative time phrase.
				__( 'Failed %s' ),
				suffix
		  );
}

export function MainView( {
	site,
	activity,
	lastSyncLog,
	onSetupClick,
	onDisconnectClick,
}: Props ) {
	const connector = useConnector();
	const { enabled: agenticEnabled, reason: agenticReason } = useAgenticFeatures();
	const isOffline = agenticReason === 'offline';
	const login = useLogin();
	const { data: snapshots } = useSnapshots();
	const { data: connectedSites } = useConnectedWpcomSites( site.id );
	const [ syncFlyoutOpen, setSyncFlyoutOpen ] = useState( false );
	const [ syncDirection, setSyncDirection ] = useState< SyncDirection >( 'push' );
	const [ syncUseCase, setSyncUseCase ] = useState< SyncUseCase >( 'everything' );
	const [ customSyncOptions, setCustomSyncOptions ] = useState< SyncCustomOptions >(
		DEFAULT_CUSTOM_SYNC_OPTIONS
	);
	const [ selectedThemePaths, setSelectedThemePaths ] = useState< string[] >( [] );
	const [ selectedPluginPaths, setSelectedPluginPaths ] = useState< string[] >( [] );

	const previewSnapshot = useMemo(
		() => pickLatestSnapshot( snapshots, site.id ),
		[ snapshots, site.id ]
	);
	const isPreviewExpired = previewSnapshot !== undefined && isSnapshotExpired( previewSnapshot );
	const liveSite = useMemo( () => pickLiveSite( connectedSites ), [ connectedSites ] );
	const syncItemsQuery = useQuery( {
		queryKey: [ 'liveSyncItems', site.id, liveSite?.id, syncDirection ],
		queryFn: () => connector.getLiveSyncItems( site.id, liveSite!.id, syncDirection ),
		enabled: syncFlyoutOpen && !! liveSite,
		staleTime: 30_000,
	} );
	const latestBackupQuery = useQuery( {
		queryKey: [ 'liveSyncLatestBackupTime', liveSite?.id ],
		queryFn: () => connector.getLiveSyncLatestBackupTime( liveSite!.id ),
		enabled: syncFlyoutOpen && !! liveSite,
		staleTime: 60_000,
	} );
	const syncItems = useMemo(
		() =>
			syncItemsQuery.data ?? {
				...EMPTY_SYNC_ITEMS,
				source: syncDirection === 'push' ? ( 'local' as const ) : ( 'remote' as const ),
			},
		[ syncDirection, syncItemsQuery.data ]
	);
	const activeThemeItem = useMemo(
		() => getActiveThemeItem( site, syncItems.themes ),
		[ site, syncItems.themes ]
	);
	const syncOptions = useMemo(
		() =>
			getSyncOptions( {
				direction: syncDirection,
				useCase: syncUseCase,
				items: syncItems,
				activeThemePath: activeThemeItem?.path,
				selectedThemePaths,
				selectedPluginPaths,
				customOptions: customSyncOptions,
			} ),
		[
			syncDirection,
			syncUseCase,
			syncItems,
			activeThemeItem?.path,
			selectedThemePaths,
			selectedPluginPaths,
			customSyncOptions,
		]
	);
	const syncUseCaseNeedsActiveTheme =
		syncUseCase === 'active-theme' ||
		( syncUseCase === 'customize' && customSyncOptions.themes === 'active-theme' );
	const syncUseCaseNeedsChosenThemes =
		syncUseCase === 'customize' && customSyncOptions.themes === 'choose-themes';
	const syncUseCaseNeedsChosenPlugins =
		syncUseCase === 'customize' && customSyncOptions.plugins === 'choose-plugins';
	const useCaseNeedsItems =
		syncUseCaseNeedsActiveTheme || syncUseCaseNeedsChosenThemes || syncUseCaseNeedsChosenPlugins;
	const canSubmit =
		syncOptions.optionsToSync.length > 0 && ! ( useCaseNeedsItems && syncItemsQuery.isLoading );

	useEffect( () => {
		if ( ! syncUseCaseNeedsActiveTheme ) {
			return;
		}

		setSelectedThemePaths( activeThemeItem ? [ activeThemeItem.path ] : [] );
	}, [ activeThemeItem, syncUseCaseNeedsActiveTheme ] );

	useEffect( () => {
		if ( ! syncUseCaseNeedsChosenThemes || selectedThemePaths.length > 0 ) {
			return;
		}

		const initialThemePath = pickInitialThemePath( site, syncItems.themes );
		if ( initialThemePath ) {
			setSelectedThemePaths( [ initialThemePath ] );
		}
	}, [ selectedThemePaths.length, site, syncItems.themes, syncUseCaseNeedsChosenThemes ] );

	const startSite = useStartSite();
	const stopSite = useStopSite();
	const publishPreviewSite = usePublishPreviewSite();
	const pushSiteToLive = usePushSiteToLive();
	const pullSiteFromLive = usePullSiteFromLive();

	const isStarting = useIsSiteStarting( site.id );
	const isStopping = useIsSiteStopping( site.id );
	const isLocalTransitioning = isStarting || isStopping;
	const { push: isPushPending, pull: isPullPending } = useIsSiteSyncing( site.id );
	const isPreviewActivityPending = activity?.kind === 'pending' && activity.direction === 'preview';
	const isPreviewPending = publishPreviewSite.isPending || isPreviewActivityPending;
	const liveSyncActivity = isLiveSyncPending( activity ) ? activity : null;
	const isLiveSyncActivityPending = !! liveSyncActivity;
	// Preview / push / pull all mutate the same local site; running them
	// concurrently would wedge the site runtime.
	const isSyncing = isPreviewPending || isPushPending || isPullPending || isLiveSyncActivityPending;

	const { localSublabel } = deriveSiteStatus( site, isStarting, isStopping );
	const localSiteUrl = getSiteUrl( site );
	const canOpenLocalSite = site.running && ! isStopping;

	const getSyncActionLabel = ( idle: string, pending: string, isPending: boolean ): string => {
		if ( isPending ) {
			return pending;
		}
		if ( isSyncing ) {
			return sprintf( __( '%s (sync in progress)' ), idle );
		}
		if ( ! agenticEnabled ) {
			return isOffline
				? sprintf( __( '%s (offline)' ), idle )
				: sprintf( __( '%s (sign in required)' ), idle );
		}
		return idle;
	};

	// Checkpoints run on the user's machine, so the affordance only exists
	// where the connector can reach the CLI checkpoint engine.
	const supportsCheckpoints = connector.capabilities?.siteCheckpoints ?? false;
	const checkpoints = useCheckpoints( supportsCheckpoints ? site.id : undefined );
	const createCheckpoint = useCreateCheckpoint();
	// The list is ordered oldest → newest.
	const latestCheckpoint = checkpoints.data?.[ checkpoints.data.length - 1 ];

	const openExternal = ( url: string ) => {
		void connector.openExternalUrl( url );
	};

	const handlePreviewClick = () => {
		if ( isPreviewPending ) return;
		publishPreviewSite.mutate(
			{
				siteId: site.id,
				// The CLI cannot update an expired preview site — create a new one.
				existingHostname:
					previewSnapshot && ! isPreviewExpired
						? getSnapshotHostname( previewSnapshot )
						: undefined,
			},
			{ onSuccess: ( { url } ) => openExternal( ensureProtocol( url ) ) }
		);
	};

	const handleCopyPreviewClick = ( url: string ) => {
		void connector.copyText( url ).catch( ( error ) => {
			console.error( 'Failed to copy preview URL:', error );
		} );
	};

	const handleStartLocalClick = () => {
		if ( isLocalTransitioning || isSyncing || site.running ) return;
		startSite.mutate( site.id );
	};

	const handleStopLocalClick = () => {
		if ( isLocalTransitioning || isSyncing || ! site.running ) return;
		stopSite.mutate( site.id );
	};

	const handleSyncDirectionChange = ( direction: SyncDirection ) => {
		setSyncDirection( direction );
		setSelectedThemePaths( [] );
		setSelectedPluginPaths( [] );
	};

	const handlePullClick = ( options: LiveSyncOptions ) => {
		if ( ! liveSite || isSyncing ) return;
		pullSiteFromLive.mutate( {
			siteId: site.id,
			remoteSiteId: liveSite.id,
			options,
		} );
	};

	const handlePushClick = ( options: LiveSyncOptions ) => {
		if ( ! liveSite || isSyncing ) return;
		pushSiteToLive.mutate( {
			siteId: site.id,
			remoteSiteId: liveSite.id,
			options,
		} );
	};

	const handleSyncSubmit = () => {
		if ( ! canSubmit || isSyncing ) {
			return;
		}

		setSyncFlyoutOpen( false );
		if ( syncDirection === 'push' ) {
			handlePushClick( syncOptions );
			return;
		}
		handlePullClick( syncOptions );
	};

	const renderTooltipButton = ( {
		tooltip,
		children,
		...props
	}: ButtonProps & { tooltip: string } ) => (
		<Tooltip.Root>
			<Tooltip.Trigger render={ <Button { ...props }>{ children }</Button> } />
			<Tooltip.Popup positioner={ <Tooltip.Positioner side="top" /> }>{ tooltip }</Tooltip.Popup>
		</Tooltip.Root>
	);

	const renderUrlLink = ( { text, url, label }: { text: string; url: string; label: string } ) => (
		<Tooltip.Root>
			<Tooltip.Trigger
				render={
					<button
						type="button"
						className={ styles.urlLink }
						aria-label={ label }
						onClick={ () => openExternal( url ) }
					>
						<span>{ text }</span>
						<Icon icon={ external } size={ 12 } aria-hidden="true" />
					</button>
				}
			/>
			<Tooltip.Popup positioner={ <Tooltip.Positioner side="top" /> }>{ label }</Tooltip.Popup>
		</Tooltip.Root>
	);

	return (
		<div className={ styles.rows }>
			{ activity?.kind === 'pending' || activity?.kind === 'error' ? (
				<SyncActivityDetails activity={ activity } />
			) : null }

			<PopoverRow
				label={
					site.enableXdebug ? (
						<>
							{ __( 'Studio' ) }
							<XdebugBadge running={ site.running } />
						</>
					) : (
						__( 'Studio' )
					)
				}
				sublabel={
					<>
						{ canOpenLocalSite
							? renderUrlLink( {
									text: localSublabel,
									url: localSiteUrl,
									label: __( 'Open Studio site in your browser' ),
							  } )
							: localSublabel }
						{ supportsCheckpoints ? (
							<div>
								{ latestCheckpoint
									? sprintf(
											__( 'Checkpoint saved %s' ),
											formatRelativeTime( new Date( latestCheckpoint.createdAt ).toISOString() )
									  )
									: __( 'No checkpoints yet.' ) }
							</div>
						) : null }
					</>
				}
				action={
					<div className={ styles.rowActions }>
						{ supportsCheckpoints
							? renderTooltipButton( {
									tooltip: __( 'Save a checkpoint of the site’s files and database' ),
									variant: 'minimal',
									tone: 'neutral',
									size: 'compact',
									loading: createCheckpoint.isPending,
									onClick: () => {
										if ( ! createCheckpoint.isPending ) {
											createCheckpoint.mutate( { siteId: site.id } );
										}
									},
									children: __( 'Checkpoint' ),
							  } )
							: null }
						<LocalServerControl
							running={ site.running }
							starting={ isStarting }
							stopping={ isStopping }
							disabled={ isSyncing }
							busyLabel={
								isLocalTransitioning
									? isStopping
										? __( 'Stopping Studio site' )
										: __( 'Starting Studio site' )
									: undefined
							}
							onStart={ handleStartLocalClick }
							onStop={ handleStopLocalClick }
						/>
					</div>
				}
			/>

			{ previewSnapshot && ! isPreviewExpired ? (
				<PopoverRow
					label={ __( 'Preview' ) }
					sublabel={ __( 'Ready to share for feedback.' ) }
					action={
						<div className={ styles.rowActions }>
							{ renderTooltipButton( {
								tooltip: __( 'Open preview site in your browser' ),
								variant: 'minimal',
								tone: 'neutral',
								size: 'compact',
								onClick: () => openExternal( ensureProtocol( previewSnapshot.url ) ),
								children: __( 'View' ),
							} ) }
							<IconButton
								variant="minimal"
								tone="neutral"
								size="small"
								icon={ copy }
								label={ __( 'Copy preview URL' ) }
								className={ styles.rowActionButton }
								onClick={ () => handleCopyPreviewClick( ensureProtocol( previewSnapshot.url ) ) }
							/>
							<IconButton
								variant="minimal"
								tone="neutral"
								size="small"
								icon={ arrowUp }
								label={ getSyncActionLabel(
									__( 'Update preview site' ),
									__( 'Updating preview…' ),
									isPreviewPending
								) }
								className={ styles.rowActionButton }
								loading={ isPreviewPending }
								loadingAnnouncement={ __( 'Updating preview' ) }
								disabled={ isSyncing || ! agenticEnabled }
								focusableWhenDisabled
								onClick={ handlePreviewClick }
							/>
						</div>
					}
				/>
			) : (
				<EnvironmentActionPanel
					title={ __( 'Preview' ) }
					copy={ getPreviewPanelCopy( agenticEnabled, isOffline, isPreviewExpired ) }
					buttonLabel={ isPreviewExpired ? __( 'Share a new one' ) : __( 'Share' ) }
					variant="outline"
					tone="neutral"
					loading={ isPreviewPending }
					loadingAnnouncement={ __( 'Creating preview' ) }
					disabled={ isSyncing || ! agenticEnabled }
					onClick={ handlePreviewClick }
				/>
			) }

			{ liveSite ? (
				<div className={ styles.liveRow }>
					<PopoverRow
						label={ __( 'Live' ) }
						sublabel={ renderUrlLink( {
							text: stripProtocol( liveSite.url ),
							url: ensureProtocol( liveSite.url ),
							label: __( 'Open live site in your browser' ),
						} ) }
						action={
							<div className={ styles.rowActions }>
								<Button
									variant="outline"
									tone="neutral"
									size="compact"
									className={ styles.syncMenuButton }
									aria-haspopup="dialog"
									aria-expanded={ syncFlyoutOpen }
									disabled={ isPreviewPending }
									onClick={ () => setSyncFlyoutOpen( ( open ) => ! open ) }
								>
									{ __( 'Sync' ) }
								</Button>
							</div>
						}
					/>
					{ liveSyncActivity ? (
						<div className={ styles.liveSyncStatus }>
							<SyncProgressPanel activity={ liveSyncActivity } />
							<SyncLog entries={ getSyncLogEntries( activity ) } active />
						</div>
					) : lastSyncLog?.log.length ? (
						<div className={ styles.liveSyncStatus }>
							<LastSyncLogDisclosure summary={ lastSyncLog } />
						</div>
					) : null }
					{ syncFlyoutOpen ? (
						<SyncFlyout
							direction={ syncDirection }
							useCase={ syncUseCase }
							customOptions={ customSyncOptions }
							items={ syncItems }
							activeThemeName={
								activeThemeItem?.name ?? site.themeDetails?.name ?? site.themeDetails?.slug
							}
							selectedThemePaths={ selectedThemePaths }
							selectedPluginPaths={ selectedPluginPaths }
							isLoadingItems={ syncItemsQuery.isLoading }
							hasItemLoadingError={ syncItemsQuery.isError }
							latestBackupLabel={
								latestBackupQuery.isLoading
									? __( 'Checking latest live backup...' )
									: latestBackupQuery.isError
									? __( 'Latest live backup unavailable' )
									: getLatestBackupLabel( latestBackupQuery.data )
							}
							activity={ activity }
							canSubmit={ canSubmit }
							isPending={ syncDirection === 'push' ? isPushPending : isPullPending }
							disabled={ isSyncing }
							onDirectionChange={ handleSyncDirectionChange }
							onUseCaseChange={ setSyncUseCase }
							onCustomOptionsChange={ setCustomSyncOptions }
							onSelectedThemePathsChange={ setSelectedThemePaths }
							onSelectedPluginPathsChange={ setSelectedPluginPaths }
							onSubmit={ handleSyncSubmit }
							onDisconnect={ onDisconnectClick }
						/>
					) : null }
				</div>
			) : (
				<EnvironmentActionPanel
					title={ __( 'Live' ) }
					copy={ getLivePanelCopy( agenticEnabled, isOffline ) }
					buttonLabel={ agenticEnabled || isOffline ? __( 'Publish' ) : __( 'Log in' ) }
					variant="solid"
					tone="brand"
					loading={ ! agenticEnabled && login.isPending }
					loadingAnnouncement={ __( 'Opening login page' ) }
					disabled={ isSyncing || isOffline }
					onClick={ agenticEnabled ? onSetupClick : () => login.mutate() }
				/>
			) }
		</div>
	);
}

function SyncFlyout( {
	direction,
	useCase,
	customOptions,
	items,
	activeThemeName,
	selectedThemePaths,
	selectedPluginPaths,
	isLoadingItems,
	hasItemLoadingError,
	latestBackupLabel,
	activity,
	canSubmit,
	isPending,
	disabled,
	onDirectionChange,
	onUseCaseChange,
	onCustomOptionsChange,
	onSelectedThemePathsChange,
	onSelectedPluginPathsChange,
	onSubmit,
	onDisconnect,
}: {
	direction: SyncDirection;
	useCase: SyncUseCase;
	customOptions: SyncCustomOptions;
	items: LiveSyncItems;
	activeThemeName?: string;
	selectedThemePaths: string[];
	selectedPluginPaths: string[];
	isLoadingItems: boolean;
	hasItemLoadingError: boolean;
	latestBackupLabel: string | null;
	activity: SyncActivity | null;
	canSubmit: boolean;
	isPending: boolean;
	disabled: boolean;
	onDirectionChange: ( direction: SyncDirection ) => void;
	onUseCaseChange: ( useCase: SyncUseCase ) => void;
	onCustomOptionsChange: ( options: SyncCustomOptions ) => void;
	onSelectedThemePathsChange: ( paths: string[] ) => void;
	onSelectedPluginPathsChange: ( paths: string[] ) => void;
	onSubmit: () => void;
	onDisconnect: () => void;
} ) {
	const actionLabel = direction === 'push' ? __( 'Push' ) : __( 'Pull' );
	const itemSourceLabel = direction === 'push' ? __( 'local' ) : __( 'live' );
	const themeCountLabel = isLoadingItems
		? __( 'Loading...' )
		: getItemCountLabel( items.themes.length, itemSourceLabel, __( 'themes' ) );
	const pluginCountLabel = isLoadingItems
		? __( 'Loading...' )
		: getItemCountLabel( items.plugins.length, itemSourceLabel, __( 'plugins' ) );
	const directionHint =
		direction === 'push'
			? __( 'Move selected Studio changes to your live site.' )
			: __( 'Bring selected live-site changes into Studio.' );
	const presetDescription = getSyncPresetDescription( {
		useCase,
		activeThemeName,
		themeCountLabel,
		pluginCountLabel,
	} );
	const useCaseItems = getSyncUseCaseItems();
	const customSummary = getCustomSyncSummary( {
		customOptions,
		items,
		activeThemeName,
		selectedThemePaths,
		selectedPluginPaths,
	} );
	const activeSyncActivity = isLiveSyncPending( activity ) ? activity : null;

	return (
		<div className={ styles.syncFlyout } role="dialog" aria-label={ __( 'Sync live site' ) }>
			<div
				className={ styles.syncTabs }
				role="tablist"
				aria-label={ __( 'Sync direction' ) }
				data-direction={ direction }
			>
				<span className={ styles.syncTabIndicator } aria-hidden="true" />
				<button
					type="button"
					role="tab"
					className={ styles.syncTab }
					aria-selected={ direction === 'push' }
					onClick={ () => onDirectionChange( 'push' ) }
				>
					{ __( 'Push' ) }
				</button>
				<button
					type="button"
					role="tab"
					className={ styles.syncTab }
					aria-selected={ direction === 'pull' }
					onClick={ () => onDirectionChange( 'pull' ) }
				>
					{ __( 'Pull' ) }
				</button>
			</div>
			<div className={ styles.syncIntro }>
				<div className={ styles.syncDirectionHint }>{ directionHint }</div>
				{ latestBackupLabel ? (
					<div className={ styles.syncBackupMeta }>{ latestBackupLabel }</div>
				) : null }
			</div>
			{ activeSyncActivity ? <SyncProgressPanel activity={ activeSyncActivity } /> : null }
			{ activity?.log?.length ? (
				<SyncLog entries={ activity.log } active={ !! activeSyncActivity } />
			) : null }

			<div className={ styles.syncPresetField }>
				<SyncSelectControl
					className={ styles.syncPresetControl }
					label={ __( 'What to sync' ) }
					items={ useCaseItems }
					value={ useCase }
					disabled={ disabled }
					onChange={ onUseCaseChange }
				/>
				<div className={ styles.syncPresetDescription }>{ presetDescription }</div>
			</div>

			{ useCase === 'customize' ? (
				<SyncCustomizeControls
					customOptions={ customOptions }
					activeThemeName={ activeThemeName }
					themeCountLabel={ themeCountLabel }
					pluginCountLabel={ pluginCountLabel }
					items={ items }
					selectedThemePaths={ selectedThemePaths }
					selectedPluginPaths={ selectedPluginPaths }
					isLoadingItems={ isLoadingItems }
					hasItemLoadingError={ hasItemLoadingError }
					disabled={ disabled }
					onCustomOptionsChange={ onCustomOptionsChange }
					onSelectedThemePathsChange={ onSelectedThemePathsChange }
					onSelectedPluginPathsChange={ onSelectedPluginPathsChange }
				/>
			) : null }

			<div className={ styles.syncFooter }>
				{ useCase === 'customize' ? (
					<div className={ styles.syncSummary }>{ customSummary }</div>
				) : null }
				{ ! canSubmit ? (
					<div className={ styles.syncValidationMessage }>
						{ useCase === 'customize'
							? __( 'Choose at least one item.' )
							: __( 'Choose what to sync.' ) }
					</div>
				) : null }
				<Button
					variant="solid"
					tone="brand"
					size="compact"
					className={ styles.syncSubmitButton }
					loading={ isPending }
					loadingAnnouncement={
						direction === 'push' ? __( 'Pushing to live' ) : __( 'Pulling from live' )
					}
					disabled={ disabled || ! canSubmit }
					onClick={ onSubmit }
				>
					{ actionLabel }
				</Button>
			</div>
			<div className={ styles.syncDisconnectFooter }>
				<Button
					variant="minimal"
					tone="neutral"
					size="compact"
					className={ styles.syncDisconnectButton }
					disabled={ disabled }
					onClick={ onDisconnect }
				>
					{ __( 'Disconnect' ) }
				</Button>
			</div>
		</div>
	);
}

function getSyncPresetDescription( {
	useCase,
	activeThemeName,
	themeCountLabel,
	pluginCountLabel,
}: {
	useCase: SyncUseCase;
	activeThemeName?: string;
	themeCountLabel: string;
	pluginCountLabel: string;
} ): string {
	switch ( useCase ) {
		case 'database':
			return __( 'Posts, pages, menus, and options.' );
		case 'active-theme':
			return activeThemeName
				? sprintf( __( 'Current theme: %s.' ), activeThemeName )
				: __( 'Current site theme.' );
		case 'all-themes':
			return themeCountLabel;
		case 'all-plugins':
			return pluginCountLabel;
		case 'customize':
			return __( 'Choose a custom mix of content, files, themes, plugins, and uploads.' );
		case 'everything':
		default:
			return __( 'Content, themes, plugins, and uploads.' );
	}
}

function SyncSelectControl< Value extends string >( {
	className,
	label,
	hideLabelFromVision = false,
	size,
	items,
	value,
	disabled,
	onChange,
}: {
	className: string;
	label: string;
	hideLabelFromVision?: boolean;
	size?: SyncSelectSize;
	items: SyncSelectItem< Value >[];
	value: Value;
	disabled: boolean;
	onChange: ( value: Value ) => void;
} ) {
	const selectedItem = getSelectedSelectItem( items, value );

	return (
		<Field.Root className={ className }>
			<Field.Label hideFromVision={ hideLabelFromVision }>{ label }</Field.Label>
			<Select.Root
				items={ items }
				value={ selectedItem }
				disabled={ disabled }
				onValueChange={ ( item ) => {
					if ( item?.value ) {
						onChange( item.value );
					}
				} }
			>
				<Select.Trigger size={ size }>{ ( item ) => item?.label }</Select.Trigger>
				<Select.Popup className={ styles.syncSelectPopup }>
					{ items.map( ( item ) => (
						<Select.Item key={ item.value } value={ item } label={ item.label } size={ size }>
							{ item.label }
						</Select.Item>
					) ) }
				</Select.Popup>
			</Select.Root>
		</Field.Root>
	);
}

function getSyncProgressDetail( activity: Extract< SyncActivity, { kind: 'pending' } > ): string {
	if ( activity.direction === 'pull' ) {
		return __( 'Bringing selected live-site changes into Studio.' );
	}

	switch ( activity.phase ) {
		case 'uploading':
			return __( 'Preparing and uploading the selected Studio changes.' );
		case 'creating-backup':
			return __( 'Creating a safety backup before the live site changes.' );
		case 'applying':
			return __( 'Updating the live site with the selected changes.' );
		case 'finishing':
			return __( 'Finishing the live-site update.' );
		default:
			return __( 'Preparing the live-site update.' );
	}
}

function SyncProgressPanel( {
	activity,
}: {
	activity: Extract< SyncActivity, { kind: 'pending' } >;
} ) {
	const progress =
		typeof activity.progress === 'number'
			? Math.max( 0, Math.min( 100, Math.round( activity.progress ) ) )
			: null;
	const progressLabel =
		progress !== null
			? sprintf(
					// translators: %d: sync progress percentage.
					__( '%d%%' ),
					progress
			  )
			: __( 'Working' );

	return (
		<div className={ styles.syncProgressPanel } role="status" aria-live="polite">
			<div className={ styles.syncProgressHeader }>
				<div className={ styles.syncProgressTitle }>{ getSyncActivityLabel( activity ) }</div>
				<div className={ styles.syncProgressPercent }>{ progressLabel }</div>
			</div>
			<div className={ styles.syncProgressDetail }>{ getSyncProgressDetail( activity ) }</div>
			<div
				className={ clsx(
					styles.syncProgressTrack,
					progress === null && styles.syncProgressTrack_indeterminate
				) }
				aria-hidden="true"
			>
				{ progress !== null ? (
					<div className={ styles.syncProgressBar } style={ { width: `${ progress }%` } } />
				) : null }
			</div>
		</div>
	);
}

function SyncLog( { entries, active }: { entries: SyncLogEntry[]; active: boolean } ) {
	const now = useSyncLogClock( active, entries );

	return (
		<div className={ styles.syncLog } aria-label={ __( 'Sync log' ) }>
			<div className={ styles.syncLogTitle }>{ __( 'Sync log' ) }</div>
			<div className={ styles.syncLogEntries }>
				<SyncLogRows entries={ entries } active={ active } now={ now } />
			</div>
		</div>
	);
}

function LastSyncLogDisclosure( { summary }: { summary: SyncLogSummary } ) {
	const now = useSyncLogClock( false, summary.log );

	return (
		<details className={ styles.lastSyncLog }>
			<summary className={ styles.lastSyncLogSummary }>
				<span>{ __( 'Last sync log' ) }</span>
				<span className={ styles.lastSyncLogMeta }>{ getLastSyncLogMeta( summary ) }</span>
			</summary>
			<div className={ styles.lastSyncLogBody }>
				<SyncLogRows entries={ summary.log } active={ false } now={ now } />
			</div>
		</details>
	);
}

function useSyncLogClock( active: boolean, entries: SyncLogEntry[] ): number {
	const [ now, setNow ] = useState( () => Date.now() );

	useEffect( () => {
		setNow( Date.now() );

		if ( ! active ) {
			return;
		}

		const interval = window.setInterval( () => setNow( Date.now() ), 1000 );
		return () => window.clearInterval( interval );
	}, [ active, entries ] );

	return now;
}

function SyncLogRows( {
	entries,
	active,
	now,
}: {
	entries: SyncLogEntry[];
	active: boolean;
	now: number;
} ) {
	return (
		<>
			{ entries.map( ( entry, index ) => {
				const nextEntry = entries[ index + 1 ];
				const endTimestamp = nextEntry?.timestamp ?? ( active ? undefined : entry.timestamp );
				return (
					<div className={ styles.syncLogEntry } key={ `${ entry.timestamp }:${ entry.message }` }>
						<time className={ styles.syncLogTime } dateTime={ entry.timestamp }>
							{ formatLogDuration( entry.timestamp, endTimestamp, now ) }
						</time>
						<div className={ styles.syncLogMessage }>{ entry.message }</div>
					</div>
				);
			} ) }
		</>
	);
}

function SyncCustomizeControls( {
	customOptions,
	activeThemeName,
	themeCountLabel,
	pluginCountLabel,
	items,
	selectedThemePaths,
	selectedPluginPaths,
	isLoadingItems,
	hasItemLoadingError,
	disabled,
	onCustomOptionsChange,
	onSelectedThemePathsChange,
	onSelectedPluginPathsChange,
}: {
	customOptions: SyncCustomOptions;
	activeThemeName?: string;
	themeCountLabel: string;
	pluginCountLabel: string;
	items: LiveSyncItems;
	selectedThemePaths: string[];
	selectedPluginPaths: string[];
	isLoadingItems: boolean;
	hasItemLoadingError: boolean;
	disabled: boolean;
	onCustomOptionsChange: ( options: SyncCustomOptions ) => void;
	onSelectedThemePathsChange: ( paths: string[] ) => void;
	onSelectedPluginPathsChange: ( paths: string[] ) => void;
} ) {
	const updateCustomOptions = ( patch: Partial< SyncCustomOptions > ) => {
		onCustomOptionsChange( { ...customOptions, ...patch } );
	};
	const themeSelectionItems = getThemeSelectionItems();
	const pluginSelectionItems = getPluginSelectionItems();

	return (
		<div className={ styles.syncCustomPanel }>
			<SyncCustomToggle
				title={ __( 'Content and settings' ) }
				description={ __( 'Posts, pages, menus, and options' ) }
				checked={ customOptions.database }
				disabled={ disabled }
				onChange={ ( checked ) => updateCustomOptions( { database: checked } ) }
			/>

			<div className={ styles.syncCustomSelectField }>
				<span className={ styles.syncCustomSelectText }>
					<span className={ styles.syncCustomTitle }>{ __( 'Themes' ) }</span>
					<span className={ styles.syncCustomDescription }>
						{ activeThemeName
							? sprintf( __( 'Active theme: %s' ), activeThemeName )
							: themeCountLabel }
					</span>
				</span>
				<SyncSelectControl
					className={ styles.syncCompactSelectControl }
					label={ __( 'Theme sync option' ) }
					hideLabelFromVision
					size="compact"
					items={ themeSelectionItems }
					value={ customOptions.themes }
					disabled={ disabled }
					onChange={ ( themes ) => {
						updateCustomOptions( { themes } );
					} }
				/>
			</div>
			{ customOptions.themes === 'choose-themes' ? (
				<SyncItemChecklist
					emptyLabel={ __( 'No themes found.' ) }
					items={ items.themes }
					selectedPaths={ selectedThemePaths }
					isLoading={ isLoadingItems }
					hasError={ hasItemLoadingError }
					onSelectedPathsChange={ onSelectedThemePathsChange }
				/>
			) : null }

			<div className={ styles.syncCustomSelectField }>
				<span className={ styles.syncCustomSelectText }>
					<span className={ styles.syncCustomTitle }>{ __( 'Plugins' ) }</span>
					<span className={ styles.syncCustomDescription }>{ pluginCountLabel }</span>
				</span>
				<SyncSelectControl
					className={ styles.syncCompactSelectControl }
					label={ __( 'Plugin sync option' ) }
					hideLabelFromVision
					size="compact"
					items={ pluginSelectionItems }
					value={ customOptions.plugins }
					disabled={ disabled }
					onChange={ ( plugins ) => {
						updateCustomOptions( { plugins } );
					} }
				/>
			</div>
			{ customOptions.plugins === 'choose-plugins' ? (
				<SyncItemChecklist
					emptyLabel={ __( 'No plugins found.' ) }
					items={ items.plugins }
					selectedPaths={ selectedPluginPaths }
					isLoading={ isLoadingItems }
					hasError={ hasItemLoadingError }
					onSelectedPathsChange={ onSelectedPluginPathsChange }
				/>
			) : null }

			<SyncCustomToggle
				title={ __( 'Uploads' ) }
				description={ __( 'Media library files' ) }
				checked={ customOptions.uploads }
				disabled={ disabled }
				onChange={ ( checked ) => updateCustomOptions( { uploads: checked } ) }
			/>
		</div>
	);
}

function SyncCustomToggle( {
	title,
	description,
	checked,
	disabled,
	onChange,
}: {
	title: string;
	description: string;
	checked: boolean;
	disabled: boolean;
	onChange: ( checked: boolean ) => void;
} ) {
	return (
		<label className={ styles.syncCustomToggle }>
			<input
				type="checkbox"
				checked={ checked }
				disabled={ disabled }
				onChange={ ( event ) => onChange( event.target.checked ) }
			/>
			<span className={ styles.syncCustomToggleText }>
				<span className={ styles.syncCustomTitle }>{ title }</span>
				<span className={ styles.syncCustomDescription }>{ description }</span>
			</span>
		</label>
	);
}

function SyncItemChecklist( {
	emptyLabel,
	items,
	selectedPaths,
	isLoading,
	hasError,
	onSelectedPathsChange,
}: {
	emptyLabel: string;
	items: LiveSyncItem[];
	selectedPaths: string[];
	isLoading: boolean;
	hasError: boolean;
	onSelectedPathsChange: ( paths: string[] ) => void;
} ) {
	const toggleItem = ( path: string, selected: boolean ) => {
		if ( selected ) {
			onSelectedPathsChange( [ ...selectedPaths, path ] );
			return;
		}
		onSelectedPathsChange( selectedPaths.filter( ( selectedPath ) => selectedPath !== path ) );
	};

	if ( isLoading ) {
		return <div className={ styles.syncItemStatus }>{ __( 'Loading...' ) }</div>;
	}

	if ( hasError ) {
		return <div className={ styles.syncItemStatus }>{ __( 'Unable to load items.' ) }</div>;
	}

	if ( ! items.length ) {
		return <div className={ styles.syncItemStatus }>{ emptyLabel }</div>;
	}

	return (
		<div className={ styles.syncItemList }>
			{ items.map( ( item ) => (
				<label className={ styles.syncItem } key={ item.path }>
					<input
						type="checkbox"
						checked={ selectedPaths.includes( item.path ) }
						onChange={ ( event ) => toggleItem( item.path, event.target.checked ) }
					/>
					<span>{ item.name }</span>
				</label>
			) ) }
		</div>
	);
}

function XdebugBadge( { running }: { running: boolean } ) {
	const label = __( 'Xdebug enabled' );

	return (
		<Tooltip.Root>
			<Tooltip.Trigger
				render={
					<span
						className={ clsx( styles.xdebugBadge, ! running && styles.xdebugBadge_stopped ) }
						role="img"
						aria-label={ label }
					/>
				}
			>
				<XdebugIcon className={ styles.xdebugGlyph } />
			</Tooltip.Trigger>
			<Tooltip.Popup positioner={ <Tooltip.Positioner side="top" /> }>{ label }</Tooltip.Popup>
		</Tooltip.Root>
	);
}

function SyncActivityDetails( {
	activity,
}: {
	activity: Extract< SyncActivity, { kind: 'pending' | 'error' } >;
} ) {
	return (
		<div
			className={ clsx(
				styles.activityStatus,
				activity.kind === 'error' ? styles.activityStatusError : styles.activityStatusPending
			) }
			role="status"
			aria-live="polite"
		>
			<div className={ styles.activityStatusTitle }>{ getSyncActivityLabel( activity ) }</div>
			<div className={ styles.activityStatusMessage }>
				{ activity.message ?? __( 'Preparing the live site…' ) }
			</div>
		</div>
	);
}

function LocalServerControl( {
	running,
	starting,
	stopping,
	disabled,
	busyLabel,
	onStart,
	onStop,
}: {
	running: boolean;
	starting: boolean;
	stopping: boolean;
	disabled: boolean;
	busyLabel?: string;
	onStart: () => void;
	onStop: () => void;
} ) {
	const pending = starting || stopping;
	const targetRunning = starting ? true : stopping ? false : running;

	return (
		<button
			type="button"
			className={ clsx(
				styles.localServerControl,
				targetRunning && styles.localServerControl_running,
				pending && styles.localServerControl_pending
			) }
			aria-label={ busyLabel ?? __( 'Studio site status' ) }
			role="switch"
			aria-checked={ targetRunning }
			aria-busy={ pending || undefined }
			disabled={ disabled || pending }
			onClick={ targetRunning ? onStop : onStart }
		>
			<span className={ styles.localServerThumb } aria-hidden="true">
				<span
					className={ clsx(
						styles.localServerGlyph,
						targetRunning ? styles.pauseIcon : styles.playIcon
					) }
				/>
			</span>
		</button>
	);
}

function EnvironmentActionPanel( {
	title,
	copy,
	buttonLabel,
	variant,
	tone,
	loading,
	loadingAnnouncement,
	disabled,
	onClick,
}: {
	title: string;
	copy: string;
	buttonLabel: string;
	variant: ButtonProps[ 'variant' ];
	tone: ButtonProps[ 'tone' ];
	loading?: boolean;
	loadingAnnouncement?: string;
	disabled: boolean;
	onClick: () => void;
} ) {
	return (
		<div className={ styles.environmentActionRow }>
			<div className={ styles.environmentActionText }>
				<div className={ styles.environmentActionTitle }>{ title }</div>
				<p className={ styles.environmentActionCopy }>{ copy }</p>
			</div>
			<Button
				variant={ variant }
				tone={ tone }
				size="compact"
				className={ clsx(
					styles.environmentActionButton,
					variant === 'outline' && styles.environmentActionButton_outline
				) }
				loading={ loading }
				loadingAnnouncement={ loadingAnnouncement }
				disabled={ disabled }
				onClick={ onClick }
			>
				{ buttonLabel }
			</Button>
		</div>
	);
}
