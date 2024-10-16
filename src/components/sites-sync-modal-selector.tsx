import { SearchControl } from '@wordpress/components';
import { sprintf } from '@wordpress/i18n';
import { useI18n } from '@wordpress/react-i18n';
import { useState } from 'react';
import { SyncSite } from '../hooks/use-sync-sites';
import { cx } from '../lib/cx';
import { getIpcApi } from '../lib/get-ipc-api';
import { Badge } from './badge';
import Button from './button';
import Modal from './modal';
import { WordPressShortLogo } from './wordpress-short-logo';

export function SitesSyncModalSelector( {
	onRequestClose,
	onConnect,
	syncSites,
}: {
	onRequestClose: () => void;
	syncSites: SyncSite[];
	onConnect: ( siteId: number ) => void;
} ) {
	const { __ } = useI18n();
	const [ selectedSiteId, setSelectedSiteId ] = useState< number | null >( null );
	const [ searchQuery, setSearchQuery ] = useState< string >( '' );
	const filteredSites = syncSites.filter( ( site ) =>
		site.name.toLowerCase().includes( searchQuery.toLowerCase() )
	);
	return (
		<Modal
			className="w-3/5 h-full max-h-[84vh] [&>div]:!p-0"
			onRequestClose={ onRequestClose }
			title={ __( 'Connect a WordPress.com site' ) }
		>
			<SearchSites searchQuery={ searchQuery } setSearchQuery={ setSearchQuery } />
			<div className="h-[calc(84vh-230px)]">
				{ filteredSites.length === 0 ? (
					<div className="flex justify-center items-center h-full">
						{ searchQuery
							? sprintf( __( 'No sites found for "%s"' ), searchQuery )
							: __( 'No sites found' ) }
					</div>
				) : (
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
					onRequestClose();
				} }
				disabled={ ! selectedSiteId }
			/>
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
				className="w-full"
				placeholder={ __( 'Search sites' ) }
				onChange={ ( value ) => {
					setSearchQuery( value );
				} }
				value={ searchQuery }
				autoFocus
			/>
			<p className="a8c-helper-text text-gray-500">
				{ __( 'Syncing is supported for sites on the Business plan or above.' ) }
			</p>
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
	return (
		<div className="flex flex-col overflow-y-auto h-full">
			{ syncSites.map( ( site ) => (
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
	const isSyncable = site.syncSupport === 'syncable';
	const isNeedsTransfer = site.syncSupport === 'needs-transfer';
	const isUnsupported = site.syncSupport === 'unsupported';
	return (
		<div
			className={ cx(
				'flex py-3 px-8 items-center border-b border-a8c-gray-0 justify-between',
				isSelected && 'bg-a8c-blueberry text-white',
				! isSelected && isSyncable && 'hover:bg-a8c-blueberry-5'
			) }
			role={ isSyncable ? 'button' : undefined }
			onClick={ () => {
				if ( ! isSyncable ) {
					return;
				}
				onClick();
			} }
		>
			<div className="flex flex-col gap-0.5">
				<div className={ cx( 'a8c-body', ! isSyncable && 'text-a8c-gray-30' ) }>{ site.name }</div>
				<div className={ cx( 'a8c-body-small text-a8c-gray-30', isSelected && 'text-white' ) }>
					{ site.url }
				</div>
			</div>
			{ isSyncable && (
				<div className="flex gap-2">
					<Badge
						className={ cx(
							'bg-a8c-green-5 text-a8c-green-80',
							isSelected && 'bg-white text-a8c-blueberry'
						) }
					>
						{ __( 'Production' ) }
					</Badge>
					{ site.stagingSiteIds.length > 0 && (
						<Badge className={ cx( isSelected && 'bg-white text-a8c-blueberry' ) }>
							{ __( 'Staging' ) }
						</Badge>
					) }
				</div>
			) }
			{ isUnsupported && (
				<div className="a8c-body-small text-a8c-gray-30"> { __( 'Unsupported plan' ) }</div>
			) }
			{ isNeedsTransfer && (
				<div className="a8c-body-small text-a8c-gray-30">
					{ __( 'Please enable hosting features' ) }
				</div>
			) }
		</div>
	);
}

function Footer( {
	onRequestClose,
	onConnect,
	disabled,
}: {
	onRequestClose: () => void;
	onConnect: () => void;
	disabled: boolean;
} ) {
	const { __ } = useI18n();
	return (
		<div className="flex px-8 py-4 border-t border-a8c-gray-5 justify-between">
			<Button
				variant="link"
				className="flex items-center mb-1"
				onClick={ () => getIpcApi().openURL( 'https://wordpress.com/hosting/' ) }
			>
				<div className="a8c-subtitle text-black">{ __( 'Powered by' ) }</div>
				<WordPressShortLogo className="ml-2 h-5" />
			</Button>
			<div className="flex gap-4">
				<Button variant="link" onClick={ onRequestClose }>
					{ __( 'Cancel' ) }
				</Button>
				<Button variant="primary" disabled={ disabled } onClick={ onConnect }>
					{ __( 'Connect' ) }
				</Button>
			</div>
		</div>
	);
}
