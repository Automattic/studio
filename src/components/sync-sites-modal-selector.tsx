import { Icon, SearchControl as SearchControlWp } from '@wordpress/components';
import { __, sprintf } from '@wordpress/i18n';
import { useI18n } from '@wordpress/react-i18n';
import { useState, useEffect } from 'react';
import { ArrowIcon } from 'src/components/arrow-icon';
import Button from 'src/components/button';
import { CreateButton } from 'src/components/connect-create-buttons';
import { EnvironmentBadge } from 'src/components/environment-badge';
import Modal from 'src/components/modal';
import offlineIcon from 'src/components/offline-icon';
import { PressableLogo } from 'src/components/pressable-logo';
import { useFeatureFlags } from 'src/hooks/use-feature-flags';
import { useOffline } from 'src/hooks/use-offline';
import { cx } from 'src/lib/cx';
import { getIpcApi } from 'src/lib/get-ipc-api';
import type { SyncSite } from 'src/hooks/use-fetch-wpcom-sites/types';

const SearchControl = process.env.NODE_ENV === 'test' ? () => null : SearchControlWp;

const focusConnectButton = () => {
	const connectButton = document.querySelector( 'button#connect-button' ) as HTMLButtonElement;
	connectButton?.focus();
};

export function SyncSitesModalSelector( {
	isLoading,
	onRequestClose,
	onConnect,
	syncSites,
	onInitialRender,
	selectedSite,
}: {
	isLoading?: boolean;
	onRequestClose: () => void;
	syncSites: SyncSite[];
	onConnect: ( siteId: number ) => void;
	onInitialRender?: () => void;
	selectedSite: SiteDetails;
} ) {
	const { __ } = useI18n();
	const [ selectedSiteId, setSelectedSiteId ] = useState< number | null >( null );
	const [ searchQuery, setSearchQuery ] = useState< string >( '' );
	const isOffline = useOffline();
	const filteredSites = syncSites.filter( ( site ) => {
		const searchQueryLower = searchQuery.toLowerCase();
		return (
			site.name?.toLowerCase().includes( searchQueryLower ) ||
			site.url?.toLowerCase().includes( searchQueryLower )
		);
	} );
	const isEmpty = filteredSites.length === 0;

	useEffect( () => {
		if ( onInitialRender ) {
			onInitialRender();
		}
	}, [ onInitialRender ] );

	return (
		<Modal
			className="w-3/5 min-w-[550px] h-full max-h-[84vh] [&>div]:!p-0"
			onRequestClose={ onRequestClose }
			title={ __( 'Connect a WP.com or Pressable site' ) }
		>
			<div className="relative" data-testid="sync-sites-modal-selector">
				<SearchSites searchQuery={ searchQuery } setSearchQuery={ setSearchQuery } />
				<div className="h-[calc(84vh-232px)]">
					{ isLoading && (
						<div className="flex justify-center items-center h-full">
							{ __( 'Loading sites…' ) }
						</div>
					) }

					{ ! isLoading && isEmpty && (
						<div className="flex justify-center items-center h-full">
							{ searchQuery
								? sprintf( __( 'No sites found for "%s"' ), searchQuery )
								: __( 'No sites found' ) }
						</div>
					) }

					{ ! isLoading && ! isEmpty && (
						<ListSites
							syncSites={ filteredSites }
							selectedSiteId={ selectedSiteId }
							onSelectSite={ setSelectedSiteId }
						/>
					) }
				</div>
				<Footer
					onRequestClose={ onRequestClose }
					onConnect={ () => {
						if ( ! selectedSiteId ) {
							return;
						}
						onConnect( selectedSiteId );
					} }
					disabled={ ! selectedSiteId }
					selectedSite={ selectedSite }
				/>

				{ isOffline && (
					<div className="absolute inset-0 bg-white/80 z-10 flex items-center justify-center">
						<SyncSitesOfflineView />
					</div>
				) }
			</div>
		</Modal>
	);
}

function SearchSites( {
	searchQuery,
	setSearchQuery,
}: {
	searchQuery: string;
	setSearchQuery: ( value: string ) => void;
} ) {
	const { __ } = useI18n();
	return (
		<div className="flex flex-col px-8 pb-6 border-b border-a8c-gray-5">
			<SearchControl
				className="w-full mt-0.5 mb-2"
				placeholder={ __( 'Search sites' ) }
				onChange={ ( value ) => {
					setSearchQuery( value );
				} }
				value={ searchQuery }
				autoFocus
				__nextHasNoMarginBottom={ true }
			/>
			<p className="a8c-helper-text text-gray-500">
				{ __( 'Syncing is supported for WP.com sites on the Business plan or above.' ) }
			</p>
		</div>
	);
}

const getSortedSites = ( sites: SyncSite[] ) => {
	const order: Record< SyncSite[ 'syncSupport' ], number > = {
		syncable: 1,
		'already-connected': 2,
		deleted: 3,
		'missing-permissions': 4,
		'needs-transfer': 5,
		'needs-upgrade': 6,
		unsupported: 7,
	};

	return [ ...sites ].sort( ( a, b ) => order[ a.syncSupport ] - order[ b.syncSupport ] );
};

function ListSites( {
	syncSites,
	selectedSiteId,
	onSelectSite,
}: {
	syncSites: SyncSite[];
	selectedSiteId: null | number;
	onSelectSite: ( id: number ) => void;
} ) {
	const sortedSites = getSortedSites( syncSites );

	return (
		<div className="flex flex-col overflow-y-auto h-full pt-px">
			{ sortedSites.map( ( site ) => (
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

function SiteItem( {
	site,
	isSelected,
	onClick,
}: {
	site: SyncSite;
	isSelected: boolean;
	onClick: () => void;
} ) {
	const { __ } = useI18n();
	if ( site.isStaging ) {
		return null;
	}
	const isAlreadyConnected = site.syncSupport === 'already-connected';
	const isSyncable = site.syncSupport === 'syncable';
	const isNeedsTransfer = site.syncSupport === 'needs-transfer';
	const isMissingPermissions = site.syncSupport === 'missing-permissions';
	const needsUpgrade = site.syncSupport === 'needs-upgrade';
	const isDeleted = site.syncSupport === 'deleted';
	const isUnsupported = site.syncSupport === 'unsupported';
	const isPressable = site.isPressable;
	const environmentType = site.environmentType;

	return (
		<div
			className={ cx(
				'flex py-3 px-8 items-center border-b justify-between gap-4',
				isSelected && 'bg-a8c-blueberry text-white border-a8c-blueberry',
				! isSelected && 'border-a8c-gray-0',
				! isSelected && isSyncable && 'hover:bg-a8c-blueberry-5',
				isSyncable &&
					'focus:outline-none focus:ring-1 focus:ring-a8c-blueberry focus:relative focus:z-10'
			) }
			role={ isSyncable ? 'button' : undefined }
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
			<div className="flex flex-col gap-0.5 min-w-0">
				<div className={ cx( 'a8c-body truncate', ! isSyncable && 'text-a8c-gray-30' ) }>
					{ site.name }
				</div>
				<Button
					variant="link"
					className={ cx(
						'a8c-body-small truncate !p-0 w-full !justify-start',
						isSelected
							? '!text-inherit hover:!text-inherit'
							: '!text-a8c-gray-30 hover:!text-a8c-gray-30'
					) }
					onClick={ () => getIpcApi().openURL( site.url ) }
					onKeyDown={ ( e: React.KeyboardEvent ) => {
						if ( e.code === 'Space' || e.code === 'Enter' ) {
							e.preventDefault();
							e.stopPropagation();
							getIpcApi().openURL( site.url );
						}
					} }
				>
					{ isPressable && (
						<span className="me-1.5">
							<PressableLogo size={ 12 } />
						</span>
					) }
					<div className="truncate">{ site.url.replace( /^https?:\/\//, '' ) }</div>
					<ArrowIcon />
				</Button>
			</div>
			{ isSyncable && (
				<div className="flex gap-2">
					{ ! isPressable && (
						<>
							<EnvironmentBadge type="production" selected={ isSelected } />
							{ site.stagingSiteIds.length > 0 && (
								<EnvironmentBadge type="staging" selected={ isSelected } />
							) }
						</>
					) }

					{ isPressable && environmentType && (
						<>
							{ environmentType === 'production' && (
								<EnvironmentBadge type="production" selected={ isSelected } />
							) }
							{ environmentType === 'staging' && (
								<EnvironmentBadge type="staging" selected={ isSelected } />
							) }
						</>
					) }
				</div>
			) }
			{ isAlreadyConnected && (
				<div className="a8c-body-small text-a8c-gray-30 shrink-0">
					{ __( 'Already connected' ) }
				</div>
			) }
			{ needsUpgrade && (
				<div className="a8c-body-small text-a8c-gray-30 shrink-0 text-right">
					<Button
						variant="link"
						onClick={ () => getIpcApi().openURL( `https://wordpress.com/plans/${ site.id }` ) }
					>
						{ __( 'Upgrade plan ↗' ) }
					</Button>
				</div>
			) }
			{ isNeedsTransfer && (
				<div className="a8c-body-small text-a8c-gray-30 shrink-0 text-right">
					<Button
						variant="link"
						onClick={ () =>
							getIpcApi().openURL( `https://wordpress.com/hosting-features/${ site.id }` )
						}
					>
						{ __( 'Enable hosting features ↗' ) }
					</Button>
				</div>
			) }
			{ isMissingPermissions && (
				<div className="a8c-body-small text-a8c-gray-30 shrink-0 text-right">
					{ __( 'Missing permissions' ) }
				</div>
			) }
			{ isDeleted && (
				<div className="a8c-body-small text-a8c-gray-30 shrink-0 text-right">
					{ __( 'Deleted' ) }
				</div>
			) }
			{ isUnsupported && (
				<div className="a8c-body-small text-a8c-gray-30 shrink-0">{ __( 'Unsupported site' ) }</div>
			) }
		</div>
	);
}

function Footer( {
	onRequestClose,
	onConnect,
	disabled,
	selectedSite,
}: {
	onRequestClose: () => void;
	onConnect: () => void;
	disabled: boolean;
	selectedSite: SiteDetails;
} ) {
	const { __ } = useI18n();

	useEffect( () => {
		if ( ! disabled ) {
			focusConnectButton();
		}
	}, [ disabled ] );

	return (
		<div className="flex px-8 py-4 border-t border-a8c-gray-5 justify-between items-center">
			<CreateButton
				variant="link"
				selectedSite={ selectedSite }
				text={ __( 'Create a new WordPress.com site' ) }
			/>
			<div className="flex gap-4">
				<Button variant="link" onClick={ onRequestClose }>
					{ __( 'Cancel' ) }
				</Button>
				<Button id="connect-button" variant="primary" disabled={ disabled } onClick={ onConnect }>
					{ __( 'Connect' ) }
				</Button>
			</div>
		</div>
	);
}

const SyncSitesOfflineView = () => {
	const offlineMessage = __( 'Connecting a site requires an internet connection.' );

	return (
		<div className="flex items-center justify-center h-12 px-2 pt-4 text-a8c-gray-70 gap-1">
			<Icon className="m-1 fill-a8c-gray-70" size={ 24 } icon={ offlineIcon } />
			<span className="text-[13px] leading-[16px]">{ offlineMessage }</span>
		</div>
	);
};
