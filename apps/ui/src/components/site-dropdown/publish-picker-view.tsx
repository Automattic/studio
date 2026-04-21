import { useQueryClient } from '@tanstack/react-query';
import { __ } from '@wordpress/i18n';
import { chevronLeft, plus } from '@wordpress/icons';
import { Icon, IconButton } from '@wordpress/ui';
import { useConnector } from '@/data/core';
import { connectedWpcomSitesQueryKey } from '@/data/queries/use-connected-wpcom-sites';
import { usePushSiteToLive } from '@/data/queries/use-sync-site';
import { usePickableWpcomSites } from '@/data/queries/use-wpcom-sites';
import styles from './publish-picker-view.module.css';
import { ensureProtocol, stripProtocol } from './utils';
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
	// No `enabled` guard needed — this component only mounts when the picker
	// view is active, which is the same gating condition.
	const pickableSites = usePickableWpcomSites();
	const pushSiteToLive = usePushSiteToLive();

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
			pushSiteToLive.mutate(
				{ siteId: site.id, remoteSiteId: pickedSite.id },
				{ onSuccess: () => openExternal( ensureProtocol( pickedSite.url ) ) }
			);
		} catch ( error ) {
			console.error( 'Failed to connect WordPress.com site:', error );
		}
	};

	const handleCreateNew = () => {
		const checkoutUrl = connector.getPublishCheckoutUrl( site );
		if ( checkoutUrl ) {
			openExternal( checkoutUrl );
		}
		// The deep-link listener handles the follow-up connection once the
		// user finishes checkout, so we just close the picker here.
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
			<button type="button" className={ styles.create } onClick={ handleCreateNew }>
				<Icon icon={ plus } size={ 16 } />
				<span>{ __( 'Create a new WordPress.com site…' ) }</span>
			</button>
		</div>
	);
}
