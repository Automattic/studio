import { Icon, SearchControl as SearchControlWp } from '@wordpress/components';
import { __, sprintf } from '@wordpress/i18n';
import { useI18n } from '@wordpress/react-i18n';
import { useState, useEffect } from 'react';
import { ArrowIcon } from 'src/components/arrow-icon';
import Button from 'src/components/button';
import Modal from 'src/components/modal';
import offlineIcon from 'src/components/offline-icon';
import { PressableLogo } from 'src/components/pressable-logo';
import { WordPressLogoCircle } from 'src/components/wordpress-logo-circle';
import { useOffline } from 'src/hooks/use-offline';
import { cx } from 'src/lib/cx';
import { getIpcApi } from 'src/lib/get-ipc-api';
import { getLocalizedLink } from 'src/lib/get-localized-link';
import { CreateButton } from 'src/modules/sync/components/create-button';
import { EnvironmentBadge } from 'src/modules/sync/components/environment-badge';
import { getSiteEnvironment } from 'src/modules/sync/lib/environment-utils';
import { useI18nLocale } from 'src/stores';
import type { SyncSite, SyncModalMode } from 'src/modules/sync/types';

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
	selectedSite,
	mode = 'connect',
}: {
	isLoading?: boolean;
	onRequestClose: () => void;
	syncSites: SyncSite[];
	onConnect: ( siteId: number ) => void;
	selectedSite: SiteDetails;
	mode?: SyncModalMode;
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
			className="w-3/5 min-w-[550px] h-full max-h-[84vh] [&>div]:!p-0"
			onRequestClose={ onRequestClose }
			title={ getModalTitle() }
		>
			<div className="relative" data-testid="sync-sites-modal-selector">
				<SearchSites searchQuery={ searchQuery } setSearchQuery={ setSearchQuery } />
				<div className="h-[calc(84vh-232px)]">
					{ isLoading && (
						<div className="flex justify-center items-center h-full">
							{ __( 'Loading sites…' ) }
						</div>
					) }

					{ ! isLoading && isEmpty && searchQuery && (
						<div className="flex justify-center items-center h-full">
							{ sprintf( __( 'No sites found for "%s"' ), searchQuery ) }
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
					mode={ mode }
				/>

				{ isOffline && (
					<div className="absolute inset-0 bg-white/80 z-10 flex items-center justify-center">
						<SyncSitesOfflineView mode={ mode } />
					</div>
				) }
			</div>
		</Modal>
	);
}

export function SearchSites( {
	searchQuery,
	setSearchQuery,
}: {
	searchQuery: string;
	setSearchQuery: ( value: string ) => void;
} ) {
	const { __ } = useI18n();
	const locale = useI18nLocale();
	return (
		<div className="flex flex-col px-8 pb-6 border-b border-a8c-gray-5 shrink-0">
			<SearchControl
				className="w-full mt-0.5 mb-2 text-black"
				placeholder={ __( 'Search sites' ) }
				onChange={ ( value ) => {
					setSearchQuery( value );
				} }
				value={ searchQuery }
				autoFocus
				__nextHasNoMarginBottom={ true }
			/>
			<p className="a8c-helper-text text-gray-500">
				{ __( "Can't find your site?" ) }{ ' ' }
				<Button
					variant="link"
					onClick={ () =>
						getIpcApi().openURL( getLocalizedLink( locale, 'docsSyncSupportedSites' ) )
					}
					className="text-xs"
				>
					{ __( 'Learn more about supported sites.' ) }
					<ArrowIcon />
				</Button>
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

export function ListSites( {
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
	const isAlreadyConnected = site.syncSupport === 'already-connected';
	const isSyncable = site.syncSupport === 'syncable';
	const isNeedsTransfer = site.syncSupport === 'needs-transfer';
	const isMissingPermissions = site.syncSupport === 'missing-permissions';
	const needsUpgrade = site.syncSupport === 'needs-upgrade';
	const isDeleted = site.syncSupport === 'deleted';
	const isUnsupported = site.syncSupport === 'unsupported';
	const isPressable = site.isPressable;
	const isDisabled = isDeleted || isUnsupported || needsUpgrade || isMissingPermissions;

	return (
		<div
			className={ cx(
				'flex py-3 px-8 items-center border-b justify-between gap-4',
				isSelected && 'bg-a8c-blue-50 text-white border-a8c-blue-50',
				! isSelected && 'text-black border-a8c-gray-0',
				! isSelected && isSyncable && 'hover:bg-a8c-blue-5',
				isSyncable &&
					'focus:outline-none focus:ring-1 focus:ring-a8c-blue-50 focus:relative focus:z-10'
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
				<div
					className={ cx(
						'a8c-body truncate flex items-center',
						! isSyncable && 'text-a8c-gray-30'
					) }
				>
					{ isPressable && (
						<span className="me-1.5">
							<PressableLogo size={ 12 } />
						</span>
					) }
					{ ! isPressable && (
						<span className="me-1.5">
							<WordPressLogoCircle
								size={ 12 }
								{ ...( isSelected && { color: '#fff' } ) }
								{ ...( isDisabled && { color: '#8c8f94' } ) }
							/>
						</span>
					) }
					{ site.name }
				</div>
				<Button
					variant="link"
					className={ cx(
						'a8c-body-small truncate !p-0 w-full !justify-start',
						isSelected
							? '!text-inherit hover:!text-a8c-blue-10'
							: '!text-a8c-gray-30 hover:!text-a8c-blue-50'
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
					<div className="truncate">{ site.url.replace( /^https?:\/\//, '' ) }</div>
					<ArrowIcon />
				</Button>
			</div>
			{ isSyncable && (
				<div className="flex gap-2">
					<EnvironmentBadge type={ getSiteEnvironment( site ) } selected={ isSelected } />
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
						{ __( 'Upgrade plan' ) }
						<ArrowIcon />
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
						{ __( 'Enable hosting features' ) }
						<ArrowIcon />
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
		<div className="flex px-8 py-4 border-t border-a8c-gray-5 justify-between items-center">
			<CreateButton
				variant="link"
				selectedSite={ selectedSite }
				text={ __( 'Create a new WordPress.com site' ) }
				className="!text-a8c-blue-50 !shadow-a8c-blue-50"
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
		<div className="flex items-center justify-center h-12 px-2 pt-4 text-a8c-gray-70 gap-1">
			<Icon className="m-1 fill-a8c-gray-70" size={ 24 } icon={ offlineIcon } />
			<span className="text-[13px] leading-[16px]">{ getOfflineMessage() }</span>
		</div>
	);
};
