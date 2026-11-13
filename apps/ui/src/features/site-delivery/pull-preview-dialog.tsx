import { __ } from '@wordpress/i18n';
import { useEffect, useRef } from 'react';
import { usePullSite } from '@/data/queries/use-sync-site';
import { useSiteSyncActivity } from '@/data/sync-activity';
import {
	AlertDialog,
	Button,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from '@/lib/ui';
import type { SiteDetails, Snapshot } from '@/data/core';
import type { SitesProviderId } from '@studio/providers';

export function PullPreviewDialog( {
	site,
	snapshot,
	provider,
	disabled,
	onClose,
}: {
	site: SiteDetails;
	snapshot: Snapshot;
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
					<DialogTitle>{ __( 'Pull preview?' ) }</DialogTitle>
					<DialogDescription>
						{ __(
							"This replaces your local WordPress with the preview. Any changes you haven't pushed will be lost."
						) }
					</DialogDescription>
				</DialogHeader>
				{ pull.error ? (
					<p role="alert">{ __( 'Could not pull this preview. Please try again.' ) }</p>
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
						{ __( 'Pull preview' ) }
					</Button>
				</DialogFooter>
			</DialogContent>
		</AlertDialog>
	);
}
