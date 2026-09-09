import { useQueryClient } from '@tanstack/react-query';
import { __ } from '@wordpress/i18n';
import { external, Icon } from '@wordpress/icons';
import { Button, Dialog } from '@wordpress/ui';
import { useState } from 'react';
import { ConnectSitePicker } from '@/components/connect-site-picker';
import { useConnector } from '@/data/core';
import { connectedWpcomSitesQueryKey } from '@/data/queries/use-connected-wpcom-sites';
import { usePickableWpcomSites } from '@/data/queries/use-wpcom-sites';
import styles from './publish-site-dialog.module.css';
import type { SiteDetails } from '@/data/core';

type Props = {
	site: SiteDetails;
	open: boolean;
	onOpenChange: ( open: boolean ) => void;
};

/**
 * Choosing where a Studio site goes live. The same picker onboarding uses to
 * bring a site down into Studio, pointed the other way — one list of the
 * WordPress.com and Pressable sites this account can reach, with room to see
 * them rather than a popover to squint at.
 */
export function PublishSiteDialog( { site, open, onOpenChange }: Props ) {
	const connector = useConnector();
	const queryClient = useQueryClient();
	const pickableSites = usePickableWpcomSites();
	const [ selectedId, setSelectedId ] = useState< number | null >( null );
	const [ isConnecting, setIsConnecting ] = useState( false );
	const [ error, setError ] = useState( '' );

	const selectedSite = pickableSites.data?.find( ( candidate ) => candidate.id === selectedId );

	const close = ( next: boolean ) => {
		if ( isConnecting ) {
			return;
		}
		onOpenChange( next );
		if ( ! next ) {
			setSelectedId( null );
			setError( '' );
		}
	};

	const handleConnect = async () => {
		if ( ! selectedSite || isConnecting ) {
			return;
		}
		setIsConnecting( true );
		setError( '' );
		try {
			await connector.connectWpcomSite( site.id, {
				...selectedSite,
				localSiteId: site.id,
				syncSupport: 'already-connected',
			} );
			await queryClient.invalidateQueries( { queryKey: connectedWpcomSitesQueryKey( site.id ) } );
			close( false );
		} catch ( caught ) {
			setError(
				caught instanceof Error
					? caught.message
					: __( 'Failed to connect the site. Please try again.' )
			);
		} finally {
			setIsConnecting( false );
		}
	};

	const handleCreateNew = () => {
		const checkoutUrl = connector.getPublishCheckoutUrl( site );
		if ( checkoutUrl ) {
			// Desktop receives the new site via the wp-studio:// deep link; surfaces
			// that can't (the local web server) opt into a server-side watch instead.
			void connector.watchForPublishedSite?.( site.id );
			void connector.openExternalUrl( checkoutUrl );
		}
		// The connect listener (deep link on desktop, sync-connect SSE on the local
		// server) handles the follow-up connection, so we just get out of the way.
		close( false );
	};

	return (
		<Dialog.Root open={ open } onOpenChange={ close }>
			<Dialog.Popup size="large">
				<Dialog.Header>
					<Dialog.Title>{ __( 'Publish this site' ) }</Dialog.Title>
				</Dialog.Header>
				<Dialog.Content>
					<p className={ styles.intro }>
						{ __(
							'Choose the WordPress.com or Pressable site to publish to. Pushing sends this Studio site’s files and database there.'
						) }
					</p>
					{ error ? (
						<p role="alert" className={ styles.error }>
							{ error }
						</p>
					) : null }
					<ConnectSitePicker
						sites={ pickableSites.data }
						isLoading={ pickableSites.isLoading }
						isFetching={ pickableSites.isFetching }
						error={ pickableSites.error }
						onRefresh={ () => void pickableSites.refetch() }
						selectedId={ selectedId }
						onSelect={ setSelectedId }
						emptyTitle={ __( 'No sites available' ) }
						emptyDescription={ __(
							'Every site on this account is already connected to a Studio site, or cannot be published to.'
						) }
					/>
				</Dialog.Content>
				<Dialog.Footer>
					<Button
						variant="minimal"
						tone="neutral"
						className={ styles.createButton }
						disabled={ isConnecting }
						onClick={ handleCreateNew }
					>
						<span>{ __( 'Create a new site' ) }</span>
						<Icon icon={ external } size={ 16 } aria-hidden="true" />
					</Button>
					<Dialog.Action variant="minimal" tone="neutral" disabled={ isConnecting }>
						{ __( 'Cancel' ) }
					</Dialog.Action>
					<Button
						variant="solid"
						tone="brand"
						disabled={ ! selectedSite || isConnecting }
						loading={ isConnecting }
						loadingAnnouncement={ __( 'Connecting' ) }
						onClick={ () => void handleConnect() }
					>
						{ __( 'Connect site' ) }
					</Button>
				</Dialog.Footer>
			</Dialog.Popup>
		</Dialog.Root>
	);
}
