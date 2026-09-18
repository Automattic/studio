import { TRACKS_EVENTS } from '@studio/common/lib/record-tracks-event';
import { __, sprintf } from '@wordpress/i18n';
import { Button, Dialog } from '@wordpress/ui';
import { useState } from 'react';
import { useConnector } from '@/data/core';
import { useDisconnectWpcomSite } from '@/data/queries/use-sync-site';
import { useConfirmOnEnter } from '@/hooks/use-confirm-on-enter';
import styles from './disconnect-site-dialog.module.css';
import { stripProtocol } from './utils';
import type { SyncSite } from '@/data/core';

type Props = {
	localSiteId: string;
	liveSite: SyncSite;
	open: boolean;
	onOpenChange: ( open: boolean ) => void;
};

export function DisconnectSiteDialog( { localSiteId, liveSite, open, onOpenChange }: Props ) {
	const connector = useConnector();
	const disconnect = useDisconnectWpcomSite();
	const [ error, setError ] = useState< string | null >( null );
	const confirmLabel = __( 'Disconnect' );
	const handleKeyDown = useConfirmOnEnter( confirmLabel );

	const handleConfirm = () => {
		setError( null );
		disconnect.mutate(
			{ siteId: localSiteId, remoteSiteId: liveSite.id },
			{
				onSuccess: () => {
					// Emitted here rather than in `useDisconnectWpcomSite` so a future
					// non-user-initiated cleanup reusing that hook isn't counted.
					void connector.trackEvent( TRACKS_EVENTS.SYNC_DISCONNECT );
					onOpenChange( false );
				},
				onError: ( err: Error ) => {
					setError( err.message ?? __( 'Unable to disconnect. Please try again.' ) );
				},
			}
		);
	};

	return (
		<Dialog.Root
			open={ open }
			onOpenChange={ ( next ) => {
				if ( ! disconnect.isPending ) {
					onOpenChange( next );
					if ( ! next ) {
						setError( null );
					}
				}
			} }
		>
			<Dialog.Popup size="small" onKeyDown={ handleKeyDown }>
				<Dialog.Header>
					<Dialog.Title>
						{ sprintf( __( 'Disconnect %s' ), stripProtocol( liveSite.url ) ) }
					</Dialog.Title>
				</Dialog.Header>
				<Dialog.Content>
					<p className={ styles.dialogText }>
						{ __(
							'Your WordPress.com site will not be affected. You can reconnect it later from this menu.'
						) }
					</p>
					{ error ? <div className={ styles.dialogError }>{ error }</div> : null }
				</Dialog.Content>
				<Dialog.Footer>
					<Dialog.Action variant="minimal" tone="neutral" disabled={ disconnect.isPending }>
						{ __( 'Cancel' ) }
					</Dialog.Action>
					<Button
						variant="solid"
						tone="brand"
						loading={ disconnect.isPending }
						loadingAnnouncement={ __( 'Disconnecting' ) }
						onClick={ handleConfirm }
					>
						{ confirmLabel }
					</Button>
				</Dialog.Footer>
			</Dialog.Popup>
		</Dialog.Root>
	);
}
