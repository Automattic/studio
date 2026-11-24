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
import { useEffect, useRef } from 'react';
import { usePullSite } from '@/data/queries/use-sync-site';
import { useSiteSyncActivity } from '@/data/sync-activity';
import type { SiteDetails, Snapshot } from '@/data/core';
import type { SitesProviderId } from '@studio/providers';

export function PullPreviewDialog( {
	site,
	snapshot,
	previewName,
	provider,
	disabled,
	onClose,
}: {
	site: SiteDetails;
	snapshot: Snapshot;
	previewName: string;
	provider: SitesProviderId;
	disabled: boolean;
	onClose: () => void;
} ) {
	const pull = usePullSite();
	const activity = useSiteSyncActivity( site.id );
	useEffect( () => {
		if (
			activity?.kind === 'error' &&
			activity.direction === 'pull' &&
			activity.localChangesApplied &&
			( ! activity.provider || activity.provider === provider ) &&
			activity.remoteSiteId === snapshot.atomicSiteId
		)
			onClose();
	}, [ activity, provider, snapshot.atomicSiteId, onClose ] );
	const cancel = useRef< HTMLButtonElement >( null );
	return (
		<AlertDialog open onOpenChange={ ( open ) => ! open && ! pull.isPending && onClose() }>
			<DialogContent
				layout="confirmation"
				initialFocus={ cancel }
				finalFocus={ false }
				closeButtonDisabled={ pull.isPending }
			>
				<DialogHeader>
					<DialogTitle>
						{ sprintf(
							/* translators: %s: the preview's name. */
							__( 'Update local site from %s?' ),
							previewName
						) }
					</DialogTitle>
					<DialogDescription>
						{ __(
							'This replaces your local site with the preview. Any local changes will be lost.'
						) }
					</DialogDescription>
				</DialogHeader>
				{ pull.error ? (
					<p role="alert">
						{ __( 'Could not update your local site from this preview. Please try again.' ) }
					</p>
				) : null }
				<DialogFooter>
					<Button ref={ cancel } variant="outline" disabled={ pull.isPending } onClick={ onClose }>
						{ __( 'Cancel' ) }
					</Button>
					<Button
						variant="accent"
						disabled={ disabled }
						loading={ pull.isPending }
						onClick={ () =>
							pull.mutate(
								{
									provider,
									siteId: site.id,
									remoteSiteId: snapshot.atomicSiteId,
								},
								{ onSuccess: onClose }
							)
						}
					>
						{ __( 'Replace local site' ) }
					</Button>
				</DialogFooter>
			</DialogContent>
		</AlertDialog>
	);
}
