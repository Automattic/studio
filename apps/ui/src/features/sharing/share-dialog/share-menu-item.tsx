import { isSnapshotExpired } from '@studio/common/lib/snapshots';
import { __, sprintf } from '@wordpress/i18n';
import { PlusIcon } from 'lucide-react';
import { toast } from '@/data/app-messages';
import { useConnector } from '@/data/core';
import { useAuthUser } from '@/data/queries/use-auth-user';
import { usePublishPreviewSite } from '@/data/queries/use-preview-site';
import { useSnapshotUsage, useSnapshots } from '@/data/queries/use-snapshots';
import { getSnapshotOpenUrl, getSnapshotUrl } from '@/data/snapshot-url';
import { useSiteSyncActivity } from '@/data/sync-activity';
import { useOpenHeaderPanel } from '@/data/use-open-header-panel';
import { useOffline } from '@/lib/hooks';
import { DuplicateIcon, ExternalLinkIcon, GlobeIcon, ShareIcon } from '@/lib/icons';
import { Menu } from '@/lib/ui';
import type { SiteDetails, Snapshot } from '@/data/core';

function PreviewLink( {
	snapshot,
	sequence,
	visit = false,
}: {
	snapshot: Snapshot;
	sequence: number;
	visit?: boolean;
} ) {
	const connector = useConnector();
	return (
		<Menu.Item
			onClick={ () => {
				if ( visit ) {
					void connector.openExternalUrl( getSnapshotOpenUrl( snapshot ) );
					return;
				}
				void connector.copyText( getSnapshotUrl( snapshot ) ).then(
					() => toast.success( __( 'Link copied' ) ),
					() => toast.error( __( 'Could not copy' ) )
				);
			} }
		>
			{ visit ? <GlobeIcon /> : <DuplicateIcon /> }
			<Menu.ItemLabel>
				{ snapshot.name || sprintf( __( 'Preview %d' ), snapshot.sequence ?? sequence ) }
			</Menu.ItemLabel>
			{ visit ? <ExternalLinkIcon data-icon="inline-end" /> : null }
		</Menu.Item>
	);
}

export function SiteShareMenuItem( { site, disabled }: { site: SiteDetails; disabled: boolean } ) {
	const openHeaderPanel = useOpenHeaderPanel();
	const user = useAuthUser();
	const snapshots = useSnapshots( user.data?.id );
	const usage = useSnapshotUsage( user.data?.id );
	const publish = usePublishPreviewSite();
	const activity = useSiteSyncActivity( site.id );
	const offline = useOffline();
	const canCreate =
		!! user.data &&
		usage.isSuccess &&
		! usage.data?.siteCreationBlocked &&
		( usage.data?.siteCount ?? 0 ) < ( usage.data?.siteLimit ?? Infinity );
	const createDisabled =
		disabled || offline || publish.isPending || activity?.kind === 'pending' || ! canCreate;
	const createPreview = () => {
		if ( createDisabled ) return;
		publish.mutate( { siteId: site.id } );
	};
	const previews = ( snapshots.data ?? [] )
		.filter( ( snapshot ) => snapshot.localSiteId === site.id && ! isSnapshotExpired( snapshot ) )
		.sort( ( a, b ) => b.date - a.date );
	const openSharing = () => openHeaderPanel( { panel: 'share', siteId: site.id } );
	return (
		<Menu.SubmenuRoot>
			<Menu.SubmenuTrigger disabled={ disabled }>
				<ShareIcon />
				{ __( 'Share' ) }
			</Menu.SubmenuTrigger>
			<Menu.SubmenuPopup>
				<Menu.Item disabled={ createDisabled } onClick={ createPreview }>
					<PlusIcon />
					{ __( 'Create preview' ) }
				</Menu.Item>
				<Menu.Item onClick={ openSharing }>
					<ShareIcon />
					{ __( 'Manage sharing' ) }
				</Menu.Item>
				{ previews.length ? (
					<>
						<Menu.Separator />
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
									/>
								) ) }
							</Menu.SubmenuPopup>
						</Menu.SubmenuRoot>
						<Menu.SubmenuRoot>
							<Menu.SubmenuTrigger>
								<GlobeIcon />
								{ __( 'Visit previews' ) }
							</Menu.SubmenuTrigger>
							<Menu.SubmenuPopup>
								{ previews.map( ( snapshot, index ) => (
									<PreviewLink
										key={ snapshot.atomicSiteId }
										snapshot={ snapshot }
										sequence={ previews.length - index }
										visit
									/>
								) ) }
							</Menu.SubmenuPopup>
						</Menu.SubmenuRoot>
					</>
				) : null }
			</Menu.SubmenuPopup>
		</Menu.SubmenuRoot>
	);
}
