import { __ } from '@wordpress/i18n';
import { useRef } from 'react';
import { useIsSiteBusy } from '@/data/queries/use-sites';
import { useDeleteSnapshot } from '@/data/queries/use-snapshots';
import { getSnapshotHostname, getSnapshotUrl } from '@/data/snapshot-url';
import { useSiteSyncActivity } from '@/data/sync-activity';
import { SiteCard, getWebsiteThumbnailUrl } from '@/features/site-card';
import { useOffline } from '@/lib/hooks';
import {
	AlertDialog,
	Button,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from '@/lib/ui';
import { RenamePreviewDialog } from './rename-preview-dialog';
import styles from './style.module.css';
import type { SiteDetails, Snapshot } from '@/data/core';

export type PreviewManagementAction = {
	kind: 'rename' | 'delete';
	snapshot: Snapshot;
	trigger: HTMLButtonElement | null;
};

export function PreviewManagementDialog( {
	action,
	site,
	onClose,
}: {
	action: PreviewManagementAction;
	site: SiteDetails;
	onClose: () => void;
} ) {
	return action.kind === 'rename' ? (
		<RenamePreviewDialog snapshot={ action.snapshot } onClose={ onClose } />
	) : (
		<DeletePreviewDialog snapshot={ action.snapshot } site={ site } onClose={ onClose } />
	);
}

function DeletePreviewDialog( {
	snapshot,
	site,
	onClose,
}: {
	snapshot: Snapshot;
	site: SiteDetails;
	onClose: () => void;
} ) {
	const remove = useDeleteSnapshot();
	const cancel = useRef< HTMLButtonElement >( null );
	const offline = useOffline();
	const siteBusy = useIsSiteBusy( site );
	const activity = useSiteSyncActivity( site.id );
	const creating =
		activity?.kind === 'pending' && activity.direction === 'preview' && ! activity.hostname;
	return (
		<AlertDialog
			open
			onOpenChange={ ( next ) => {
				if ( ! next && ! remove.isPending ) onClose();
			} }
		>
			<DialogContent
				layout="confirmation"
				closeButtonDisabled={ remove.isPending }
				initialFocus={ cancel }
				finalFocus={ false }
			>
				<DialogHeader>
					<DialogTitle>{ __( 'Delete preview?' ) }</DialogTitle>
					<DialogDescription tone="default">
						{ __( 'Its shared link will stop working.' ) }
					</DialogDescription>
				</DialogHeader>
				<SiteCard
					title={ getSnapshotHostname( snapshot ) }
					thumbnailUrl={ getWebsiteThumbnailUrl( getSnapshotUrl( snapshot ) ) }
					updatedAt={ snapshot.date }
				/>
				{ remove.error ? (
					<p className={ styles.error } role="alert">
						{ remove.error.message }
					</p>
				) : null }
				<DialogFooter>
					<Button
						ref={ cancel }
						variant="outline"
						disabled={ remove.isPending }
						onClick={ onClose }
					>
						{ __( 'Cancel' ) }
					</Button>
					<Button
						variant="destructive"
						disabled={ offline || ( ! creating && ( siteBusy || activity?.kind === 'pending' ) ) }
						loading={ remove.isPending }
						onClick={ () =>
							remove.mutate( { hostname: getSnapshotHostname( snapshot ) }, { onSuccess: onClose } )
						}
					>
						{ __( 'Delete preview' ) }
					</Button>
				</DialogFooter>
			</DialogContent>
		</AlertDialog>
	);
}
