import { isSnapshotExpired } from '@studio/common/lib/snapshots';
import { __, sprintf } from '@wordpress/i18n';
import { PlusIcon } from 'lucide-react';
import { toast } from '@/data/app-messages';
import { useConnector } from '@/data/core';
import { markPreviewSeen } from '@/data/preview-ready';
import { useAuthUser } from '@/data/queries/use-auth-user';
import { useSnapshots } from '@/data/queries/use-snapshots';
import { getSnapshotOpenUrl, getSnapshotUrl } from '@/data/snapshot-url';
import { useOpenHeaderPanel } from '@/data/use-open-header-panel';
import { DuplicateIcon, ExternalLinkIcon, ShareIcon } from '@/lib/icons';
import { Menu } from '@/lib/ui';
import type { SiteDetails, Snapshot } from '@/data/core';

function PreviewLink( {
	snapshot,
	siteId,
	sequence,
	visit = false,
}: {
	snapshot: Snapshot;
	siteId: string;
	sequence: number;
	visit?: boolean;
} ) {
	const connector = useConnector();
	return (
		<Menu.Item
			onClick={ () => {
				if ( visit ) {
					void connector.openExternalUrl( getSnapshotOpenUrl( snapshot ) );
					markPreviewSeen( siteId );
					return;
				}
				void connector.copyText( getSnapshotUrl( snapshot ) ).then(
					() => toast.success( __( 'Link copied' ) ),
					() => toast.error( __( 'Could not copy' ) )
				);
				markPreviewSeen( siteId );
			} }
		>
			<Menu.ItemLabel>
				{ snapshot.name || sprintf( __( 'Preview %d' ), snapshot.sequence ?? sequence ) }
			</Menu.ItemLabel>
		</Menu.Item>
	);
}

export function SiteShareMenuItem( { site, disabled }: { site: SiteDetails; disabled: boolean } ) {
	const openHeaderPanel = useOpenHeaderPanel();
	const user = useAuthUser();
	const snapshots = useSnapshots( user.data?.id );
	const previews = ( snapshots.data ?? [] )
		.filter( ( snapshot ) => snapshot.localSiteId === site.id && ! isSnapshotExpired( snapshot ) )
		.sort( ( a, b ) => b.date - a.date );
	const openSharing = () => openHeaderPanel( { panel: 'share', siteId: site.id } );
	if ( previews.length ) {
		return (
			<Menu.SubmenuRoot>
				<Menu.SubmenuTrigger disabled={ disabled }>
					<ShareIcon />
					{ __( 'Share' ) }
				</Menu.SubmenuTrigger>
				<Menu.SubmenuPopup>
					<Menu.SubmenuRoot>
						<Menu.SubmenuTrigger>
							<DuplicateIcon />
							{ __( 'Copy links' ) }
						</Menu.SubmenuTrigger>
						<Menu.SubmenuPopup>
							{ previews.map( ( snapshot, index ) => (
								<PreviewLink
									key={ snapshot.atomicSiteId }
									snapshot={ snapshot }
									sequence={ previews.length - index }
									siteId={ site.id }
								/>
							) ) }
						</Menu.SubmenuPopup>
					</Menu.SubmenuRoot>
					<Menu.SubmenuRoot>
						<Menu.SubmenuTrigger>
							<ExternalLinkIcon />
							{ __( 'Visit previews' ) }
						</Menu.SubmenuTrigger>
						<Menu.SubmenuPopup>
							{ previews.map( ( snapshot, index ) => (
								<PreviewLink
									key={ snapshot.atomicSiteId }
									snapshot={ snapshot }
									sequence={ previews.length - index }
									siteId={ site.id }
									visit
								/>
							) ) }
						</Menu.SubmenuPopup>
					</Menu.SubmenuRoot>
					<Menu.Separator />
					<Menu.Item onClick={ openSharing }>
						<PlusIcon />
						{ __( 'Create preview' ) }
					</Menu.Item>
					<Menu.Item onClick={ openSharing }>
						<ShareIcon />
						{ __( 'Manage sharing' ) }
					</Menu.Item>
				</Menu.SubmenuPopup>
			</Menu.SubmenuRoot>
		);
	}
	return (
		<Menu.Item disabled={ disabled } onClick={ openSharing }>
			<ShareIcon />
			{ __( 'Share' ) }
		</Menu.Item>
	);
}
