import { Icon } from '@wordpress/components';
import { cloudUpload, cloudDownload } from '@wordpress/icons';
import { useI18n } from '@wordpress/react-i18n';
import { useMemo } from 'react';
import { SyncSite } from '../hooks/use-fetch-wpcom-sites';
import { getIpcApi } from '../lib/get-ipc-api';
import { ArrowIcon } from './arrow-icon';
import { Badge } from './badge';
import Button from './button';
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
}: {
	connectedSites: SyncSite[];
	openSitesSyncSelector: () => void;
	disconnectSite: ( id: number ) => void;
} ) {
	const { __ } = useI18n();
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

	const handleDisconnectSite = async ( sectionId: number ) => {
		const dontShowDisconnectWarning = localStorage.getItem( 'dontShowDisconnectWarning' );

		if ( ! dontShowDisconnectWarning ) {
			const CANCEL_BUTTON_INDEX = 0;
			const DISCONNECT_BUTTON_INDEX = 1;

			const { response, checkboxChecked } = await getIpcApi().showMessageBox( {
				type: 'info',
				message: __( 'Disconnect site' ),
				detail: __(
					'Your WordPress.com site will not be affected by disconnecting it from Studio.'
				),
				buttons: [ __( 'Cancel' ), __( 'Disconnect' ) ],
				cancelId: CANCEL_BUTTON_INDEX,
				checkboxLabel: __( "Don't show this warning again" ),
				checkboxChecked: false,
			} );

			if ( response === DISCONNECT_BUTTON_INDEX ) {
				if ( checkboxChecked ) {
					localStorage.setItem( 'dontShowDisconnectWarning', 'true' );
				}
				disconnectSite( sectionId );
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
								className="!ml-auto !text-a8c-gray-70 hover:!text-a8c-blueberry"
								onClick={ () => handleDisconnectSite( section.id ) }
							>
								{ __( 'Disconnect' ) }
							</Button>
						</div>
						{ section.connectedSites.map( ( connectedSite ) => (
							<div
								key={ connectedSite.id }
								className="flex items-center gap-2 py-2.5 border-b border-a8c-gray-0 px-8"
							>
								<div className="flex items-left min-w-20 mr-6">
									{ connectedSite.isStaging ? (
										<Badge>{ __( 'Staging' ) }</Badge>
									) : (
										<Badge className="bg-a8c-green-5 text-a8c-green-80">
											{ __( 'Production' ) }
										</Badge>
									) }
								</div>

								<Button
									variant="link"
									className="!text-a8c-gray-70 hover:!text-a8c-blueberry"
									onClick={ () => {
										getIpcApi().openURL( connectedSite.url );
									} }
								>
									{ connectedSite.url } <ArrowIcon />
								</Button>
								<div className="flex gap-2 pl-4 ml-auto">
									<Button variant="link" className="!text-black hover:!text-a8c-blueberry">
										<Icon icon={ cloudDownload } />
										{ __( 'Pull' ) }
									</Button>
									<Button variant="link" className="!text-black hover:!text-a8c-blueberry">
										<Icon icon={ cloudUpload } />
										{ __( 'Push' ) }
									</Button>
								</div>
							</div>
						) ) }
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
