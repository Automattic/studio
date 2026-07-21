import { useQueryClient } from '@tanstack/react-query';
import { __ } from '@wordpress/i18n';
import { chevronLeft, plus } from '@wordpress/icons';
import { Icon, IconButton } from '@wordpress/ui';
import { useConnector } from '@/data/core';
import { useAuthUser } from '@/data/queries/use-auth-user';
import { connectedWpcomSitesQueryKey } from '@/data/queries/use-connected-wpcom-sites';
import { usePickableWpcomSites } from '@/data/queries/use-wpcom-sites';
import styles from './publish-picker-view.module.css';
import { stripProtocol } from './utils';
import type { SiteDetails, SyncSite } from '@/data/core';

type Props = {
	site: SiteDetails;
	// Fires after any action that ends the picker flow (site picked, checkout
	// link opened, or the back button pressed). The parent uses this to swap
	// back to the main dropdown view.
	onClose: () => void;
};

export function PublishPickerView( { site, onClose }: Props ) {
	const connector = useConnector();
	const queryClient = useQueryClient();
	const { data: authUser } = useAuthUser();
	const pickableSites = usePickableWpcomSites();

	const openExternal = ( url: string ) => {
		void connector.openExternalUrl( url );
	};

	const handlePickSite = async ( pickedSite: SyncSite ) => {
		try {
			await connector.connectWpcomSite( site.id, {
				...pickedSite,
				localSiteId: site.id,
				syncSupport: 'already-connected',
			} );
			await queryClient.invalidateQueries( {
				queryKey: connectedWpcomSitesQueryKey( site.id ),
			} );
			onClose();
		} catch ( error ) {
			console.error( 'Failed to connect WordPress.com site:', error );
		}
	};

	const handleCreateNew = () => {
		const checkoutUrl = connector.getPublishCheckoutUrl( site );
		if ( checkoutUrl ) {
			// Desktop receives the new site via the wp-studio:// deep link; surfaces
			// that can't (the local web server) opt into a server-side watch instead.
			void connector.watchForPublishedSite?.( site.id );
			openExternal( checkoutUrl );
		}
		// The connect listener (deep link on desktop, sync-connect SSE on the local
		// server) handles the follow-up connection, so we just close the picker.
		onClose();
	};

	return (
		<div className={ styles.picker }>
			<div className={ styles.header }>
				<IconButton
					variant="minimal"
					tone="neutral"
					size="small"
					icon={ chevronLeft }
					label={ __( 'Back' ) }
					onClick={ onClose }
				/>
				<span className={ styles.title }>{ __( 'Publish this site' ) }</span>
			</div>
			{ authUser ? (
				<div className={ styles.body }>
					{ pickableSites.isLoading ? (
						<div className={ styles.status }>{ __( 'Loading sites…' ) }</div>
					) : pickableSites.data && pickableSites.data.length > 0 ? (
						<ul className={ styles.list }>
							{ pickableSites.data.map( ( candidate ) => (
								<li key={ candidate.id }>
									<button
										type="button"
										className={ styles.item }
										onClick={ () => void handlePickSite( candidate ) }
									>
										<span className={ styles.itemName }>{ candidate.name || candidate.url }</span>
										<span className={ styles.itemUrl }>{ stripProtocol( candidate.url ) }</span>
									</button>
								</li>
							) ) }
						</ul>
					) : (
						<div className={ styles.status }>
							{ __( 'No WordPress.com sites available to publish to.' ) }
						</div>
					) }
				</div>
			) : null }
			<button type="button" className={ styles.create } onClick={ handleCreateNew }>
				<Icon icon={ plus } size={ 16 } />
				<span>{ __( 'Create a new WordPress.com site…' ) }</span>
			</button>
		</div>
	);
}
