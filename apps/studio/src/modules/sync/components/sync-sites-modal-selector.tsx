import { Icon, SearchControl as SearchControlWp, Spinner } from '@wordpress/components';
import { __, sprintf } from '@wordpress/i18n';
import { useI18n } from '@wordpress/react-i18n';
import { useState, useEffect, useCallback } from 'react';
import { ArrowIcon } from 'src/components/arrow-icon';
import { Badge } from 'src/components/badge';
import Button from 'src/components/button';
import Modal from 'src/components/modal';
import offlineIcon from 'src/components/offline-icon';
import { useAuth } from 'src/hooks/use-auth';
import { useOffline } from 'src/hooks/use-offline';
import { cx } from 'src/lib/cx';
import { getIpcApi } from 'src/lib/get-ipc-api';
import { getLocalizedLink } from 'src/lib/get-localized-link';
import { CreateButton } from 'src/modules/sync/components/create-button';
import { EnvironmentBadge } from 'src/modules/sync/components/environment-badge';
import { NoWpcomSitesModal } from 'src/modules/sync/components/no-wpcom-sites-modal';
import { getSiteEnvironment } from 'src/modules/sync/lib/environment-utils';
import { useI18nLocale, useRootSelector } from 'src/stores';
import {
	connectedSitesSelectors,
	useGetConnectedSitesForLocalSiteQuery,
} from 'src/stores/sync/connected-sites';
import { useGetWpComSitesQuery } from 'src/stores/sync/wpcom-sites';
import type { SyncSite } from '@studio/common/types/sync';
import type { SyncModalMode } from 'src/modules/sync/types';

const SearchControl = process.env.NODE_ENV === 'test' ? () => null : SearchControlWp;

const focusConnectButton = () => {
	const connectButton = document.querySelector( 'button#connect-button' ) as HTMLButtonElement;
	connectButton?.focus();
};

export function SyncSitesModalSelector( {
	onRequestClose,
	onConnect,
	selectedSite,
	mode = 'connect',
}: {
	onRequestClose: () => void;
	onConnect: ( site: SyncSite ) => void;
	selectedSite: SiteDetails;
	mode?: SyncModalMode;
} ) {
	const { __ } = useI18n();
	const { user } = useAuth();
	const [ selectedSiteId, setSelectedSiteId ] = useState< number | null >( null );
	const isOffline = useOffline();

	const { data: connectedSites = [] } = useGetConnectedSitesForLocalSiteQuery( {
		localSiteId: selectedSite.id,
		userId: user?.id,
	} );
	const connectedSiteIds = connectedSites.map( ( { id } ) => id );

	const sitesQuery = useSitesQuery( { connectedSiteIds, userId: user?.id } );

	if (
		sitesQuery.sites.length === 0 &&
		sitesQuery.isSuccess &&
		! sitesQuery.isLoading &&
		! sitesQuery.searchQuery
	) {
		return <NoWpcomSitesModal onRequestClose={ onRequestClose } selectedSite={ selectedSite } />;
	}

	const getModalTitle = () => {
		switch ( mode ) {
			case 'push':
				return __( 'Publish your site' );
			case 'pull':
				return __( 'Select a site to import' );
			case 'connect':
			default:
				return __( 'Connect your site' );
		}
	};

	return (
		<Modal
			className="sync-sites-modal w-[90%] max-w-[1100px] h-full max-h-[90vh] [&>div]:!p-0 [&_[role=document]]:flex [&_[role=document]]:flex-col [&_[role=document]>div:last-child]:flex-1 [&_[role=document]>div:last-child]:min-h-0"
			onRequestClose={ onRequestClose }
			title={ getModalTitle() }
		>
			<div className="relative flex flex-col h-full" data-testid="sync-sites-modal-selector">
				<SitesListContent
					sitesQuery={ sitesQuery }
					selectedSiteId={ selectedSiteId }
					onSelectSite={ setSelectedSiteId }
				/>
				<Footer
					onRequestClose={ onRequestClose }
					onConnect={ () => {
						if ( ! selectedSiteId ) {
							return;
						}
						const selected = sitesQuery.sites.find( ( s ) => s.id === selectedSiteId );
						if ( ! selected ) {
							return;
						}
						onConnect( selected );
					} }
					disabled={ ! selectedSiteId }
					selectedSite={ selectedSite }
					mode={ mode }
				/>

				{ isOffline && (
					<div className="absolute inset-0 bg-frame/80 z-10 flex items-center justify-center">
						<SyncSitesOfflineView mode={ mode } />
					</div>
				) }
			</div>
		</Modal>
	);
}

export function SitesHelperLinks( {
	onRefresh,
	isRefreshing,
}: {
	onRefresh: () => void;
	isRefreshing: boolean;
} ) {
	const { __ } = useI18n();
	const locale = useI18nLocale();
	return (
		<p className="a8c-helper-text text-frame-text-secondary">
			<Button
				variant="link"
				onClick={ onRefresh }
				disabled={ isRefreshing }
				className="!p-0 text-xs"
			>
				{ isRefreshing ? __( 'Refreshing…' ) : __( 'Refresh list' ) }
			</Button>
			{ ' · ' }
			<Button
				variant="link"
				onClick={ () =>
					getIpcApi().openURL( getLocalizedLink( locale, 'docsSyncSupportedSites' ) )
				}
				className="!p-0 text-xs"
			>
				{ __( 'Supported sites' ) }
				<ArrowIcon />
			</Button>
		</p>
	);
}

function SearchSites( {
	showSearchInput,
	searchQuery,
	setSearchQuery,
	onRefresh,
	isRefreshing,
}: {
	showSearchInput: boolean;
	searchQuery: string;
	setSearchQuery: ( value: string ) => void;
	onRefresh: () => void;
	isRefreshing: boolean;
} ) {
	const { __ } = useI18n();
	return (
		<div className="flex flex-col items-center px-8 pb-4 shrink-0 max-w-lg mx-auto w-full">
			{ showSearchInput && (
				<SearchControl
					className="w-full mt-0.5 mb-2 text-frame-text"
					placeholder={ __( 'Search sites' ) }
					onChange={ ( value ) => {
						setSearchQuery( value );
					} }
					value={ searchQuery }
					autoFocus
					__nextHasNoMarginBottom={ true }
				/>
			) }
			<SitesHelperLinks onRefresh={ onRefresh } isRefreshing={ isRefreshing } />
		</div>
	);
}

export interface SitesQueryResult {
	sites: SyncSite[];
	total: number;
	isLoading: boolean;
	isFetching: boolean;
	isSuccess: boolean;
	searchQuery: string;
	setSearchQuery: ( query: string ) => void;
	refetch: () => void;
}

export function useSitesQuery( {
	connectedSiteIds,
	userId,
}: {
	connectedSiteIds?: number[];
	userId?: number;
} ): SitesQueryResult {
	const [ searchQuery, setSearchQuery ] = useState( '' );
	const [ debouncedSearch, setDebouncedSearch ] = useState( '' );

	// Debounce search input for server-side search
	useEffect( () => {
		const timer = setTimeout( () => {
			setDebouncedSearch( searchQuery );
		}, 300 );
		return () => clearTimeout( timer );
	}, [ searchQuery ] );

	const { data, isLoading, isFetching, isSuccess, refetch } = useGetWpComSitesQuery( {
		connectedSiteIds,
		userId,
		perPage: 100,
		search: debouncedSearch || undefined,
	} );

	const handleSetSearchQuery = useCallback( ( query: string ) => {
		setSearchQuery( query );
	}, [] );

	return {
		sites: data?.sites ?? [],
		total: data?.total ?? 0,
		isLoading,
		isFetching,
		isSuccess,
		searchQuery,
		setSearchQuery: handleSetSearchQuery,
		refetch: () => void refetch(),
	};
}

export function SitesListContent( {
	sitesQuery,
	selectedSiteId,
	onSelectSite,
	headerAction,
}: {
	sitesQuery: SitesQueryResult;
	selectedSiteId: number | null;
	onSelectSite: ( id: number ) => void;
	headerAction?: React.ReactNode;
} ) {
	const { __ } = useI18n();
	const { sites, isLoading, isFetching, searchQuery, setSearchQuery } = sitesQuery;

	const isEmpty = sites.length === 0 && ! isLoading && ! isFetching;
	const emptyMessage = searchQuery
		? sprintf( __( 'No sites found for "%s"' ), searchQuery )
		: __( 'No WordPress.com sites found on this account.' );

	const SEARCH_VISIBILITY_THRESHOLD = 5;
	const showSearchInput = searchQuery.length > 0 || sites.length > SEARCH_VISIBILITY_THRESHOLD;

	return (
		<div className="flex flex-col flex-1 min-h-0 h-full">
			{ ! isLoading && (
				<SearchSites
					showSearchInput={ showSearchInput }
					searchQuery={ searchQuery }
					setSearchQuery={ setSearchQuery }
					onRefresh={ sitesQuery.refetch }
					isRefreshing={ sitesQuery.isFetching }
				/>
			) }
			{ headerAction && <div className="px-8 pb-4 shrink-0">{ headerAction }</div> }
			<div className="flex-1 min-h-0 relative flex flex-col">
				{ isLoading ? (
					<div className="flex-1 flex flex-col justify-center items-center gap-3">
						<Spinner className="!mt-0 [&>circle]:stroke-frame-text-secondary" />
						<span className="text-sm text-frame-text-secondary">
							{ __( 'Loading your sites…' ) }
						</span>
					</div>
				) : isEmpty ? (
					<div className="flex-1 flex flex-col justify-center items-center gap-3">
						<span className="text-sm text-frame-text-secondary">{ emptyMessage }</span>
						{ ! searchQuery && (
							<CreateButton
								variant="link"
								text={ __( 'Create a new WordPress.com site' ) }
								className="!text-frame-theme !shadow-frame-theme"
							/>
						) }
					</div>
				) : (
					<ListSites
						syncSites={ sites }
						selectedSiteId={ selectedSiteId }
						onSelectSite={ onSelectSite }
					/>
				) }
			</div>
		</div>
	);
}

function SiteGrid( {
	sites,
	selectedSiteId,
	onSelectSite,
}: {
	sites: SyncSite[];
	selectedSiteId: null | number;
	onSelectSite: ( id: number ) => void;
} ) {
	return (
		<div
			className="grid gap-5"
			style={ { gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))' } }
		>
			{ sites.map( ( site ) => (
				<SiteItem
					key={ site.id }
					site={ site }
					isSelected={ site.id === selectedSiteId }
					onClick={ () => onSelectSite( site.id ) }
				/>
			) ) }
		</div>
	);
}

function ListSites( {
	syncSites,
	selectedSiteId,
	onSelectSite,
}: {
	syncSites: SyncSite[];
	selectedSiteId: null | number;
	onSelectSite: ( id: number ) => void;
} ) {
	const { __ } = useI18n();

	const syncable = syncSites.filter( ( s ) => s.syncSupport === 'syncable' );
	const alreadyConnected = syncSites.filter( ( s ) => s.syncSupport === 'already-connected' );
	const needsTransfer = syncSites.filter( ( s ) => s.syncSupport === 'needs-transfer' );
	const needsUpgrade = syncSites.filter( ( s ) => s.syncSupport === 'needs-upgrade' );
	const other = syncSites.filter(
		( s ) =>
			s.syncSupport === 'unsupported' ||
			s.syncSupport === 'missing-permissions' ||
			s.syncSupport === 'deleted'
	);

	const sections: Array< { title: string; description?: string; sites: SyncSite[] } > = [];
	if ( syncable.length > 0 ) {
		sections.push( { title: '', sites: syncable } );
	}
	if ( alreadyConnected.length > 0 ) {
		sections.push( {
			title: __( 'Already connected' ),
			description: __( 'These sites are already linked to a local site.' ),
			sites: alreadyConnected,
		} );
	}
	if ( needsTransfer.length > 0 ) {
		sections.push( {
			title: __( 'Enable hosting features first' ),
			description: __(
				'These sites need hosting features turned on before they can sync. You can do this from WordPress.com.'
			),
			sites: needsTransfer,
		} );
	}
	if ( needsUpgrade.length > 0 ) {
		sections.push( {
			title: __( 'Upgrade your plan to sync' ),
			description: __(
				'Syncing requires a Business plan or higher. Upgrade on WordPress.com to get started.'
			),
			sites: needsUpgrade,
		} );
	}
	if ( other.length > 0 ) {
		sections.push( {
			title: __( 'Not available for sync' ),
			description: __(
				"These sites can't be synced due to missing permissions or other limitations."
			),
			sites: other,
		} );
	}

	return (
		<div className="overflow-y-auto h-full">
			<div className="pointer-events-none sticky top-0 h-10 -mb-10 z-10 bg-gradient-to-b from-frame to-transparent" />
			<div className="min-h-full flex flex-col justify-center">
				<div className="px-8 pt-4 pb-8">
					{ sections.map( ( section ) => (
						<div key={ section.title || 'syncable' } className={ section.title ? 'mt-8' : '' }>
							{ section.title && (
								<div className="mb-5 px-1.5">
									<h3 className="text-base font-medium text-frame-text">{ section.title }</h3>
									{ section.description && (
										<p className="text-sm text-frame-text-secondary mt-1">
											{ section.description }
										</p>
									) }
								</div>
							) }
							<SiteGrid
								sites={ section.sites }
								selectedSiteId={ selectedSiteId }
								onSelectSite={ onSelectSite }
							/>
						</div>
					) ) }
				</div>
			</div>
			<div className="pointer-events-none sticky bottom-0 h-10 -mt-10 z-10 bg-gradient-to-t from-frame to-transparent" />
		</div>
	);
}

function getMshotUrl( siteUrl: string ): string {
	return `https://s0.wp.com/mshots/v1/${ encodeURIComponent( siteUrl ) }?w=600&h=400`;
}

function SiteThumbnail( {
	site,
	isDisabled,
	isLoading,
	showBadge = false,
	showOverlayCta = false,
}: {
	site: SyncSite;
	isDisabled: boolean;
	isLoading: boolean;
	showBadge?: boolean;
	showOverlayCta?: boolean;
} ) {
	if ( isLoading ) {
		return <div className="w-full aspect-[3/2] rounded-lg skeleton-bg" aria-label="Loading" />;
	}

	const mshotUrl = getMshotUrl( site.url );

	return (
		<div
			className={ cx(
				'relative w-full aspect-[3/2] rounded-lg overflow-hidden bg-frame-surface border border-frame-border',
				isDisabled && 'opacity-50'
			) }
		>
			<img src={ mshotUrl } alt="" className="w-full h-full object-cover" loading="lazy" />
			{ showBadge && (
				<div className="absolute bottom-1.5 right-1.5 flex gap-1">
					<Badge className="bg-black/40 text-white backdrop-blur-sm">
						{ site.isPressable ? __( 'Pressable' ) : __( 'WP.com' ) }
					</Badge>
					<div className="rounded border border-white/30 bg-white/90 backdrop-blur-sm">
						<EnvironmentBadge type={ getSiteEnvironment( site ) } selected={ false } />
					</div>
				</div>
			) }
			{ showOverlayCta && (
				<div className="absolute inset-0 flex flex-col items-center justify-center gap-1.5 bg-black/20">
					<SiteOverlayCta site={ site } />
				</div>
			) }
		</div>
	);
}

function SiteOverlayCta( { site }: { site: SyncSite } ) {
	const { __ } = useI18n();

	if ( site.syncSupport === 'needs-upgrade' ) {
		return (
			<>
				<Button
					variant="secondary"
					className="!text-xs !px-3 !py-1.5 !h-auto !bg-white !text-a8c-gray-900 hover:!text-a8c-gray-900 !shadow-sm"
					onClick={ ( e: React.MouseEvent ) => {
						e.stopPropagation();
						getIpcApi().openURL( `https://wordpress.com/plans/${ site.id }` );
					} }
				>
					{ __( 'Upgrade plan' ) }
					<ArrowIcon />
				</Button>
				{ site.planName && (
					<span className="text-[11px] text-white px-2 py-0.5 rounded bg-black/50 backdrop-blur-sm">
						{ site.planName }
					</span>
				) }
			</>
		);
	}
	if ( site.syncSupport === 'needs-transfer' ) {
		return (
			<Button
				variant="secondary"
				className="!text-xs !px-3 !py-1.5 !h-auto !bg-white !text-a8c-gray-900 hover:!text-a8c-gray-900 !shadow-sm"
				onClick={ ( e: React.MouseEvent ) => {
					e.stopPropagation();
					getIpcApi().openURL( `https://wordpress.com/hosting-features/${ site.id }` );
				} }
			>
				{ __( 'Enable' ) }
				<ArrowIcon />
			</Button>
		);
	}
	return null;
}

function SiteStatusLabel( { site }: { site: SyncSite } ) {
	const { __ } = useI18n();

	if ( site.syncSupport === 'already-connected' ) {
		return (
			<span className="text-[11px] text-frame-text-secondary">{ __( 'Already connected' ) }</span>
		);
	}
	if ( site.syncSupport === 'missing-permissions' ) {
		return (
			<span className="text-[11px] text-frame-text-secondary">{ __( 'Missing permissions' ) }</span>
		);
	}
	if ( site.syncSupport === 'deleted' ) {
		return <span className="text-[11px] text-frame-text-secondary">{ __( 'Deleted' ) }</span>;
	}
	if ( site.syncSupport === 'unsupported' ) {
		return <span className="text-[11px] text-frame-text-secondary">{ __( 'Unsupported' ) }</span>;
	}
	return null;
}

export function SiteItem( {
	site,
	isSelected,
	onClick,
}: {
	site: SyncSite;
	isSelected: boolean;
	onClick: () => void;
} ) {
	const { __ } = useI18n();
	const isSiteLoading = useRootSelector( connectedSitesSelectors.selectIsLoadingSiteId( site.id ) );
	const isSyncable = site.syncSupport === 'syncable';
	const hasOverlayCta =
		site.syncSupport === 'needs-upgrade' || site.syncSupport === 'needs-transfer';
	const isDisabled =
		site.syncSupport === 'deleted' ||
		site.syncSupport === 'unsupported' ||
		site.syncSupport === 'missing-permissions';

	return (
		<div
			className={ cx(
				'flex flex-col rounded-xl overflow-hidden transition-colors p-1.5',
				isSelected && 'ring-2 ring-frame-theme bg-frame-theme/5',
				! isSelected && isSyncable && 'hover:bg-frame-surface',
				isSyncable
					? 'cursor-pointer focus:outline-none focus:ring-2 focus:ring-frame-theme'
					: 'cursor-default',
				isDisabled && 'opacity-60'
			) }
			role="button"
			aria-disabled={ ! isSyncable }
			tabIndex={ isSyncable ? 0 : -1 }
			onKeyDown={ ( e: React.KeyboardEvent ) => {
				if ( ( e.code === 'Space' || e.code === 'Enter' ) && isSyncable ) {
					e.preventDefault();
					onClick();
					focusConnectButton();
				}
			} }
			onClick={ () => {
				if ( ! isSyncable ) {
					return;
				}
				onClick();
			} }
		>
			<SiteThumbnail
				site={ site }
				isDisabled={ isDisabled }
				isLoading={ isSiteLoading }
				showBadge={ isSyncable }
				showOverlayCta={ hasOverlayCta }
			/>
			<div className="flex flex-col pt-1.5 px-1.5 min-w-0">
				{ isSiteLoading ? (
					<div className="h-4 w-3/4 rounded skeleton-bg" aria-label={ __( 'Loading site name' ) } />
				) : (
					<div className="text-sm font-medium truncate text-frame-text">{ site.name }</div>
				) }
				{ isSiteLoading ? (
					<div
						className="h-3 w-1/2 rounded skeleton-bg mt-0.5"
						aria-label={ __( 'Loading site URL' ) }
					/>
				) : (
					<div className="text-xs text-frame-text-secondary truncate">
						{ site.url.replace( /^https?:\/\//, '' ) }
					</div>
				) }
				{ ! isSiteLoading && ! isSyncable && <SiteStatusLabel site={ site } /> }
			</div>
		</div>
	);
}

function Footer( {
	onRequestClose,
	onConnect,
	disabled,
	selectedSite,
	mode = 'connect',
}: {
	onRequestClose: () => void;
	onConnect: () => void;
	disabled: boolean;
	selectedSite: SiteDetails;
	mode?: SyncModalMode;
} ) {
	const { __ } = useI18n();

	const getButtonText = () => {
		switch ( mode ) {
			case 'push':
			case 'pull':
				return __( 'Next' );
			case 'connect':
			default:
				return __( 'Connect' );
		}
	};

	useEffect( () => {
		if ( ! disabled ) {
			focusConnectButton();
		}
	}, [ disabled ] );

	return (
		<div className="flex px-8 py-4 justify-between items-center">
			<CreateButton
				variant="link"
				selectedSite={ selectedSite }
				text={ __( 'Create a new WordPress.com site' ) }
				className="!text-frame-theme !shadow-frame-theme"
			/>
			<div className="flex gap-4">
				<Button variant="link" onClick={ onRequestClose }>
					{ __( 'Cancel' ) }
				</Button>
				<Button id="connect-button" variant="primary" disabled={ disabled } onClick={ onConnect }>
					{ getButtonText() }
				</Button>
			</div>
		</div>
	);
}

const SyncSitesOfflineView = ( { mode = 'connect' }: { mode?: SyncModalMode } ) => {
	const { __ } = useI18n();
	const getOfflineMessage = () => {
		switch ( mode ) {
			case 'push':
				return __( 'Publishing your site requires an internet connection.' );
			case 'pull':
				return __( 'Importing a remote site requires an internet connection.' );
			case 'connect':
			default:
				return __( 'Connecting a site requires an internet connection.' );
		}
	};

	return (
		<div className="flex items-center justify-center h-12 px-2 pt-4 text-frame-text-secondary gap-1">
			<Icon className="m-1 fill-frame-text-secondary" size={ 24 } icon={ offlineIcon } />
			<span className="text-[13px] leading-[16px]">{ getOfflineMessage() }</span>
		</div>
	);
};
