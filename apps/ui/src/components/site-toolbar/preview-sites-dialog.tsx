import { DAY_MS, DEMO_SITE_EXPIRATION_DAYS } from '@studio/common/constants';
import { isSnapshotExpired } from '@studio/common/lib/snapshots';
import { __, sprintf } from '@wordpress/i18n';
import { copy, external, Icon } from '@wordpress/icons';
import { Button, Dialog } from '@wordpress/ui';
import { useMemo } from 'react';
import { useConnector } from '@/data/core';
import { usePublishPreviewSite } from '@/data/queries/use-preview-site';
import { useSnapshots } from '@/data/queries/use-snapshots';
import styles from './preview-sites-dialog.module.css';
import { ensureProtocol, getSnapshotHostname, stripProtocol } from './utils';
import type { SiteDetails, Snapshot } from '@/data/core';

type Props = {
	site: SiteDetails;
	// True while a push or pull holds the site's runtime; publishing a preview
	// would fight them for it.
	busy: boolean;
	open: boolean;
	onOpenChange: ( open: boolean ) => void;
};

function expirySummary( snapshot: Snapshot ): string {
	if ( isSnapshotExpired( snapshot ) ) {
		return __( 'Expired' );
	}
	const remainingDays = Math.max(
		1,
		Math.ceil( ( snapshot.date + DEMO_SITE_EXPIRATION_DAYS * DAY_MS - Date.now() ) / DAY_MS )
	);
	return sprintf(
		// translators: %d: number of days before a preview link expires.
		__( 'Expires in %d days' ),
		remainingDays
	);
}

/**
 * The preview links this site has published: where they point, how long
 * they last, and the one control that matters — refreshing a link with the
 * site's current contents.
 */
export function PreviewSitesDialog( { site, busy, open, onOpenChange }: Props ) {
	const connector = useConnector();
	const { data: snapshots } = useSnapshots();
	const publishPreviewSite = usePublishPreviewSite();

	const previews = useMemo(
		() =>
			( snapshots ?? [] )
				.filter( ( snapshot ) => snapshot.localSiteId === site.id )
				.sort( ( a, b ) => b.date - a.date ),
		[ snapshots, site.id ]
	);

	const openExternal = ( url: string ) => {
		void connector.openExternalUrl( ensureProtocol( url ) );
	};

	const publish = ( existing?: Snapshot ) => {
		publishPreviewSite.mutate(
			{
				siteId: site.id,
				// The CLI cannot update an expired preview site — create a new one.
				existingHostname:
					existing && ! isSnapshotExpired( existing ) ? getSnapshotHostname( existing ) : undefined,
			},
			{ onSuccess: ( { url } ) => openExternal( url ) }
		);
	};

	const isPublishing = publishPreviewSite.isPending;

	return (
		<Dialog.Root open={ open } onOpenChange={ onOpenChange }>
			<Dialog.Popup size="medium">
				<Dialog.Header>
					<Dialog.Title>{ __( 'Preview sites' ) }</Dialog.Title>
				</Dialog.Header>
				<Dialog.Content>
					<p className={ styles.intro }>
						{ __(
							'A preview link is a temporary copy of this site on WordPress.com, for sharing work before it goes live.'
						) }
					</p>
					{ previews.length === 0 ? (
						<p className={ styles.empty }>{ __( 'No preview links yet.' ) }</p>
					) : (
						<ul className={ styles.list }>
							{ previews.map( ( snapshot ) => (
								<li key={ snapshot.url } className={ styles.row }>
									<div className={ styles.rowText }>
										<span className={ styles.rowTitle }>{ stripProtocol( snapshot.url ) }</span>
										<span className={ styles.rowMeta }>{ expirySummary( snapshot ) }</span>
									</div>
									<div className={ styles.rowActions }>
										<Button
											variant="outline"
											tone="neutral"
											size="compact"
											disabled={ busy || isPublishing }
											loading={ isPublishing }
											loadingAnnouncement={ __( 'Updating preview' ) }
											onClick={ () => publish( snapshot ) }
										>
											{ isSnapshotExpired( snapshot ) ? __( 'Republish' ) : __( 'Update' ) }
										</Button>
										<Button
											variant="minimal"
											tone="neutral"
											size="compact"
											onClick={ () => openExternal( snapshot.url ) }
										>
											{ __( 'Open' ) }
											<Icon icon={ external } size={ 16 } aria-hidden="true" />
										</Button>
										<Button
											variant="minimal"
											tone="neutral"
											size="compact"
											onClick={ () => {
												void connector
													.copyText( ensureProtocol( snapshot.url ) )
													.catch( ( error ) => {
														console.error( 'Failed to copy preview URL:', error );
													} );
											} }
										>
											{ __( 'Copy link' ) }
											<Icon icon={ copy } size={ 16 } aria-hidden="true" />
										</Button>
									</div>
								</li>
							) ) }
						</ul>
					) }
				</Dialog.Content>
				<Dialog.Footer>
					<Dialog.Action variant="minimal" tone="neutral">
						{ __( 'Done' ) }
					</Dialog.Action>
					<Button
						variant="solid"
						tone="brand"
						disabled={ busy || isPublishing }
						loading={ isPublishing }
						loadingAnnouncement={ __( 'Publishing preview' ) }
						onClick={ () => publish() }
					>
						{ __( 'New preview link' ) }
					</Button>
				</Dialog.Footer>
			</Dialog.Popup>
		</Dialog.Root>
	);
}
