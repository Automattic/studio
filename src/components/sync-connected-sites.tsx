import { Icon } from '@wordpress/components';
import { sprintf } from '@wordpress/i18n';
import { cloudUpload, cloudDownload } from '@wordpress/icons';
import { useI18n } from '@wordpress/react-i18n';
import { useMemo } from 'react';
import { useSyncSites } from '../hooks/sync-sites';
import { SyncSite } from '../hooks/use-fetch-wpcom-sites';
import { useSyncStatesProgressInfo } from '../hooks/use-sync-states-progress-info';
import { getIpcApi } from '../lib/get-ipc-api';
import { ArrowIcon } from './arrow-icon';
import { Badge } from './badge';
import Button from './button';
import { CheckIcon } from './check-icon';
import { ErrorIcon } from './error-icon';
import ProgressBar from './progress-bar';
import Tooltip from './tooltip';
import { WordPressLogoCircle } from './wordpress-logo-circle';

interface ConnectedSiteSection {
	id: number;
	name: string;
	provider: 'wpcom';
	connectedSites: SyncSite[];
}

export function SyncConnectedSites( {
	connectedSites,
	openSitesSyncSelector,
	disconnectSite,
	selectedSite,
}: {
	connectedSites: SyncSite[];
	openSitesSyncSelector: () => void;
	disconnectSite: ( id: number ) => void;
	selectedSite: SiteDetails;
} ) {
	const { __ } = useI18n();
	const { pullSite, clearPullState, getPullState, isAnySitePulling } = useSyncSites();
	const { isKeyPulling, isKeyFinished, isKeyFailed } = useSyncStatesProgressInfo();
	const siteSections: ConnectedSiteSection[] = useMemo( () => {
		const siteSections: ConnectedSiteSection[] = [];
		const processedSites = new Set< number >();

		connectedSites.forEach( ( connectedSite ) => {
			if ( processedSites.has( connectedSite.id ) ) {
				return; // Skip if we've already processed this site
			}

			const section: ConnectedSiteSection = {
				id: connectedSite.id,
				name: connectedSite.name,
				provider: 'wpcom',
				connectedSites: [ connectedSite ],
			};

			processedSites.add( connectedSite.id );

			if ( connectedSite.stagingSiteIds ) {
				for ( const id of connectedSite.stagingSiteIds ) {
					const stagingSite = connectedSites.find( ( site ) => site.id === id );
					if ( stagingSite ) {
						section.connectedSites.push( stagingSite );
						processedSites.add( stagingSite.id );
					}
				}
			}

			siteSections.push( section );
		} );

		return siteSections;
	}, [ connectedSites ] );

	const handleDisconnectSite = async ( sectionId: number, sectionName?: string ) => {
		const dontShowDisconnectWarning = localStorage.getItem( 'dontShowDisconnectWarning' );
		if ( ! dontShowDisconnectWarning ) {
			const CANCEL_BUTTON_INDEX = 1;
			const DISCONNECT_BUTTON_INDEX = 0;

			const disconnectMessage = sectionName
				? sprintf( __( 'Disconnect %s' ), sectionName )
				: __( 'Disconnect site' );

			const { response, checkboxChecked } = await getIpcApi().showMessageBox( {
				message: disconnectMessage,
				detail: __(
					'Your WordPress.com site will not be affected by disconnecting it from Studio.'
				),
				buttons: [ __( 'Disconnect' ), __( 'Cancel' ) ],
				cancelId: CANCEL_BUTTON_INDEX,
				checkboxLabel: __( "Don't ask again" ),
			} );

			if ( response === DISCONNECT_BUTTON_INDEX ) {
				if ( checkboxChecked ) {
					localStorage.setItem( 'dontShowDisconnectWarning', 'true' );
				}
				disconnectSite( sectionId );
				siteSections
					.find( ( section ) => section.id === sectionId )
					?.connectedSites.forEach( ( connectedSite ) => {
						clearPullState( selectedSite.id, connectedSite.id );
					} );
			}
		} else {
			disconnectSite( sectionId );
		}
	};

	return (
		<div className="flex flex-col h-full overflow-hidden">
			<div className="flex flex-col flex-1 pt-8 overflow-y-auto">
				{ siteSections.map( ( section ) => (
					<div key={ section.id } className="flex flex-col gap-2 mb-6">
						<div className="flex items-center gap-2 py-2.5 border-b border-a8c-gray-0 px-8">
							<WordPressLogoCircle />
							<div className="a8c-label-semibold">{ section.name }</div>
							<Button
								variant="link"
								className="!ml-auto !text-a8c-gray-70 hover:!text-a8c-red-50 "
								onClick={ () => handleDisconnectSite( section.id, section.name ) }
								disabled={ isAnySitePulling }
							>
								{ __( 'Disconnect' ) }
							</Button>
						</div>
						{ section.connectedSites.map( ( connectedSite ) => {
							const sitePullState = getPullState( selectedSite.id, connectedSite.id );
							const isPulling = sitePullState && isKeyPulling( sitePullState.status.key );
							const isError = sitePullState && isKeyFailed( sitePullState.status.key );
							const hasPullFinished = sitePullState && isKeyFinished( sitePullState.status.key );
							return (
								<div
									key={ connectedSite.id }
									className="flex items-center gap-2 min-h-14 border-b border-a8c-gray-0 px-8"
								>
									<div className="flex items-left min-w-20 mr-6 shrink-0">
										{ connectedSite.isStaging ? (
											<Badge>{ __( 'Staging' ) }</Badge>
										) : (
											<Badge className="bg-a8c-green-5 text-a8c-green-80">
												{ __( 'Production' ) }
											</Badge>
										) }
									</div>

									<Tooltip text={ connectedSite.url } className="overflow-hidden">
										<Button
											variant="link"
											className="!text-a8c-gray-70 hover:!text-a8c-blueberry max-w-[100%]"
											onClick={ () => {
												getIpcApi().openURL( connectedSite.url );
											} }
										>
											<span className="truncate">{ connectedSite.url }</span> <ArrowIcon />
										</Button>
									</Tooltip>
									<div className="flex gap-2 pl-4 ml-auto shrink-0">
										{ isPulling && (
											<div className="flex flex-col gap-2 min-w-44">
												<div className="a8c-body-small">{ sitePullState.status.message }</div>
												<ProgressBar value={ sitePullState.status.progress } maxValue={ 100 } />
											</div>
										) }
										{ isError && (
											<div className="flex gap-4 pl-4 ml-auto items-center shrink-0 text-a8c-red-50">
												<span className="flex items-center gap-2">
													<ErrorIcon />
													{ __( 'Error pulling changes' ) }
												</span>
												<Button
													variant="link"
													className="ml-3"
													onClick={ () => clearPullState( selectedSite.id, connectedSite.id ) }
												>
													{ __( 'Clear' ) }
												</Button>
											</div>
										) }
										{ hasPullFinished && (
											<div className="flex gap-4 pl-4 ml-auto items-center shrink-0 text-a8c-green-50">
												<span className="flex items-center gap-2">
													<CheckIcon />
													{ __( 'Pull complete' ) }
												</span>
												<Button
													variant="link"
													className="ml-3"
													onClick={ () => clearPullState( selectedSite.id, connectedSite.id ) }
												>
													{ __( 'Clear' ) }
												</Button>
											</div>
										) }
										{ ! isPulling && ! hasPullFinished && ! isError && (
											<div className="flex gap-2 pl-4 ml-auto shrink-0 h-5">
												<Button
													variant="link"
													className="!text-black hover:!text-a8c-blueberry"
													onClick={ () => {
														pullSite( connectedSite, selectedSite );
													} }
													disabled={ isAnySitePulling }
												>
													<Icon icon={ cloudDownload } />
													{ __( 'Pull' ) }
												</Button>
												<Button
													variant="link"
													className="!text-black hover:!text-a8c-blueberry"
													disabled={ isAnySitePulling }
												>
													<Icon icon={ cloudUpload } />
													{ __( 'Push' ) }
												</Button>
											</div>
										) }
									</div>
								</div>
							);
						} ) }
					</div>
				) ) }
			</div>

			<div className="flex mt-auto gap-4 py-5 px-8 border-t border-a8c-gray-5 flex-shrink-0">
				<Button
					onClick={ openSitesSyncSelector }
					variant="secondary"
					className="!text-a8c-blueberry !shadow-a8c-blueberry"
				>
					{ __( 'Connect site' ) }
				</Button>
				<Button
					onClick={ () => {
						getIpcApi().openURL( 'https://wordpress.com/start/new-site' );
					} }
					variant="secondary"
					className="!text-a8c-blueberry !shadow-a8c-blueberry"
				>
					{ __( 'Create new site' ) }
					<ArrowIcon />
				</Button>
			</div>
		</div>
	);
}
