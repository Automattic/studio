import { TRACKS_EVENTS } from '@studio/common/lib/record-tracks-event';
import { getSyncType } from '@studio/common/lib/sync/sync-type';
import {
	AlertDialog,
	Button,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from '@studio/ds';
import { __, sprintf } from '@wordpress/i18n';
import { useRef, type RefObject } from 'react';
import { useConnector } from '@/data/core';
import { useDisconnectRemoteSite } from '@/data/queries/use-sync-site';
import type { RemoteSiteConnection } from '@/data/core';
import type { SitesProviderId } from '@studio/providers';

export function DisconnectSiteDialog( {
	siteId,
	provider,
	remote,
	returnFocus,
	onClose,
	onDisconnected,
}: {
	siteId: string;
	provider: SitesProviderId;
	remote: RemoteSiteConnection< SitesProviderId >;
	returnFocus: RefObject< HTMLButtonElement | null >;
	onClose: () => void;
	onDisconnected: () => void;
} ) {
	const connector = useConnector();
	const disconnect = useDisconnectRemoteSite();
	const cancel = useRef< HTMLButtonElement >( null );
	return (
		<AlertDialog open onOpenChange={ ( next ) => ! next && ! disconnect.isPending && onClose() }>
			<DialogContent layout="confirmation" initialFocus={ cancel } finalFocus={ returnFocus }>
				<DialogHeader>
					<DialogTitle>{ __( 'Disconnect site?' ) }</DialogTitle>
					<DialogDescription>
						{ sprintf(
							/* translators: %s: the published site's address. */
							__(
								'Remove %s from WordPress Studio? The published site and your local WordPress won’t change.'
							),
							remote.url
						) }
					</DialogDescription>
				</DialogHeader>
				{ disconnect.error && <p role="alert">{ disconnect.error.message }</p> }
				<DialogFooter>
					<Button
						ref={ cancel }
						variant="outline"
						disabled={ disconnect.isPending }
						onClick={ onClose }
					>
						{ __( 'Cancel' ) }
					</Button>
					<Button
						variant="destructive"
						loading={ disconnect.isPending }
						onClick={ () => {
							void connector.trackEvent( TRACKS_EVENTS.SYNC_DISCONNECT, {
								sync_type: getSyncType( remote, provider ),
							} );
							disconnect.mutate(
								{ provider, siteId, remoteSiteId: remote.id },
								{ onSuccess: onDisconnected }
							);
						} }
					>
						{ __( 'Disconnect site' ) }
					</Button>
				</DialogFooter>
			</DialogContent>
		</AlertDialog>
	);
}
