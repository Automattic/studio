import { DAY_MS, DEMO_SITE_EXPIRATION_DAYS } from '@studio/common/constants';
import { isSnapshotExpired } from '@studio/common/lib/snapshots';
import { __, _n, sprintf } from '@wordpress/i18n';
import { copy, Icon, moreVertical } from '@wordpress/icons';
import { Button, Dialog, IconButton } from '@wordpress/ui';
import { useMemo, useState } from 'react';
import * as Menu from '@/components/menu';
import { showToast } from '@/data/app-messages';
import { useConnector } from '@/data/core';
import { useConnectedWpcomSites } from '@/data/queries/use-connected-wpcom-sites';
import { useDeletePreviewSite, usePublishPreviewSite } from '@/data/queries/use-preview-site';
import { useSnapshots, useSnapshotUsage } from '@/data/queries/use-snapshots';
import styles from './share-dialog.module.css';
import {
	ensureProtocol,
	getConnectionLabel,
	getSnapshotHostname,
	sortConnections,
	stripProtocol,
} from './utils';
import type { SiteDetails, Snapshot } from '@/data/core';

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
		_n( 'Expires in %d day', 'Expires in %d days', remainingDays ),
		remainingDays
	);
}

type Props = {
	site: SiteDetails;
	open: boolean;
	onOpenChange: ( open: boolean ) => void;
};

// Marks the "new preview" action as the one in flight, since it has no
// snapshot URL to key on.
const NEW_PREVIEW = 'new-preview';

/**
 * Sharing a Studio site: the preview links it has published, where they point,
 * how long they last, and the controls for refreshing, opening, copying and
 * retiring each one.
 *
 * Anchored to the Share button rather than centred as a modal — publishing a
 * preview is a small errand off the header, not a task worth blacking the app
 * out for. Each row keeps only what it needs on the surface (the link, when it
 * expires, copy); the rest sits in an overflow menu.
 */
export function ShareDialog( { site, open, onOpenChange }: Props ) {
	const connector = useConnector();
	const { data: snapshots } = useSnapshots();
	const { data: usage } = useSnapshotUsage();
	const { data: connectedSites } = useConnectedWpcomSites( site.id );
	const publishPreviewSite = usePublishPreviewSite();
	const deletePreviewSite = useDeletePreviewSite();
	const [ pendingPublish, setPendingPublish ] = useState< string | null >( null );
	const [ confirmingDelete, setConfirmingDelete ] = useState< string | null >( null );

	const connections = useMemo( () => sortConnections( connectedSites ), [ connectedSites ] );

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

	const copyLink = ( url: string ) => {
		void connector
			.copyText( ensureProtocol( url ) )
			.then( () => showToast( { id: 'preview-link-copied', title: __( 'Preview link copied' ) } ) )
			.catch( ( error ) => {
				showToast( {
					intent: 'error',
					title: __( 'Failed to copy preview link' ),
					description: error instanceof Error ? error.message : String( error ),
				} );
			} );
	};

	const publish = ( existing?: Snapshot ) => {
		setPendingPublish( existing ? existing.url : NEW_PREVIEW );
		publishPreviewSite.mutate(
			{
				siteId: site.id,
				// The CLI cannot update an expired preview site — create a new one.
				existingHostname:
					existing && ! isSnapshotExpired( existing ) ? getSnapshotHostname( existing ) : undefined,
			},
			{
				onSuccess: ( { url } ) => openExternal( url ),
				onSettled: () => setPendingPublish( null ),
			}
		);
	};

	const isPublishing = publishPreviewSite.isPending;

	return (
		<Dialog.Root
			open={ open }
			onOpenChange={ ( next ) => {
				if ( ! next ) {
					setConfirmingDelete( null );
				}
				onOpenChange( next );
			} }
		>
			<Dialog.Popup size="medium" className={ styles.popup }>
				<Dialog.Header>
					<Dialog.Title>{ __( 'Share this site' ) }</Dialog.Title>
					<Dialog.CloseIcon />
				</Dialog.Header>
				<Dialog.Content>
					{ connections.length > 0 ? (
						<section className={ styles.section }>
							<h3 className={ styles.heading }>{ __( 'Live' ) }</h3>
							<ul className={ styles.cards }>
								{ connections.map( ( connection ) => (
									<li key={ connection.id } className={ styles.card }>
										<button
											type="button"
											className={ styles.rowLink }
											onClick={ () => openExternal( connection.url ) }
										>
											{ stripProtocol( connection.url ) }
										</button>
										<div className={ styles.rowSecond }>
											<span className={ styles.rowMeta }>{ getConnectionLabel( connection ) }</span>
											<div className={ styles.actions }>
												<IconButton
													variant="minimal"
													tone="neutral"
													size="small"
													icon={ copy }
													label={ __( 'Copy link' ) }
													onClick={ () => copyLink( connection.url ) }
												/>
											</div>
										</div>
									</li>
								) ) }
							</ul>
						</section>
					) : null }

					<section className={ styles.section }>
						<h3 className={ styles.heading }>{ __( 'Preview links' ) }</h3>
						<p className={ styles.intro }>
							{ __( 'Temporary copies of this site, for sharing work before it goes live.' ) }
						</p>

						{ previews.length === 0 ? (
							<p className={ styles.empty }>{ __( 'No preview links yet.' ) }</p>
						) : (
							<ul className={ styles.cards }>
								{ previews.map( ( snapshot ) => {
									const hostname = getSnapshotHostname( snapshot );
									const isDeleting =
										deletePreviewSite.isPending &&
										deletePreviewSite.variables?.hostname === hostname;
									const isConfirming = confirmingDelete === snapshot.url;
									return (
										<li key={ snapshot.url } className={ styles.card }>
											{ /* The full hostname, unwrapped and unabbreviated: telling two
									     previews of the same site apart is the whole job of this
									     line. */ }
											<button
												type="button"
												className={ styles.rowLink }
												onClick={ () => openExternal( snapshot.url ) }
											>
												{ hostname }
											</button>
											{ isConfirming ? (
												<div className={ styles.rowSecond }>
													<span className={ styles.rowMeta }>
														{ __( 'This link will stop working immediately.' ) }
													</span>
													<div className={ styles.actions }>
														<Button
															variant="minimal"
															tone="neutral"
															size="small"
															disabled={ isDeleting }
															onClick={ () => setConfirmingDelete( null ) }
														>
															{ __( 'Cancel' ) }
														</Button>
														<Button
															variant="solid"
															tone="brand"
															size="small"
															loading={ isDeleting }
															loadingAnnouncement={ __( 'Deleting preview link' ) }
															onClick={ () =>
																deletePreviewSite.mutate(
																	{ hostname },
																	{ onSuccess: () => setConfirmingDelete( null ) }
																)
															}
														>
															{ __( 'Delete' ) }
														</Button>
													</div>
												</div>
											) : (
												<div className={ styles.rowSecond }>
													<span className={ styles.rowMeta }>{ expirySummary( snapshot ) }</span>
													<div className={ styles.actions }>
														<IconButton
															variant="minimal"
															tone="neutral"
															size="small"
															icon={ copy }
															label={ __( 'Copy link' ) }
															onClick={ () => copyLink( snapshot.url ) }
														/>
														<Menu.Root modal={ false }>
															{ /* `IconButton` renders a tooltip provider, not a button,
													     so it can't take the trigger's props — the menu would
													     never open. */ }
															<Menu.Trigger
																render={
																	<Button
																		variant="minimal"
																		tone="neutral"
																		size="small"
																		className={ styles.overflowButton }
																		aria-label={ __( 'More options' ) }
																	/>
																}
															>
																<Icon icon={ moreVertical } size={ 16 } aria-hidden="true" />
															</Menu.Trigger>
															<Menu.Popup side="bottom" align="end" aboveOverlays>
																<Menu.Item onClick={ () => openExternal( snapshot.url ) }>
																	{ __( 'Open preview' ) }
																</Menu.Item>
																<Menu.Item
																	disabled={ isPublishing }
																	onClick={ () => publish( snapshot ) }
																>
																	{ isSnapshotExpired( snapshot )
																		? __( 'Republish' )
																		: __( 'Update with current contents' ) }
																</Menu.Item>
																<Menu.Separator />
																<Menu.Item onClick={ () => setConfirmingDelete( snapshot.url ) }>
																	{ __( 'Delete preview link' ) }
																</Menu.Item>
															</Menu.Popup>
														</Menu.Root>
													</div>
												</div>
											) }
										</li>
									);
								} ) }
							</ul>
						) }
					</section>
				</Dialog.Content>
				<Dialog.Footer className={ styles.footer }>
					{ usage ? (
						<span className={ styles.quotaLabel }>
							{ sprintf(
								// translators: 1: preview links used, 2: total allowed.
								__( '%1$d of %2$d preview links used' ),
								usage.siteCount,
								usage.siteLimit
							) }
						</span>
					) : (
						<span />
					) }
					<Button
						variant="solid"
						tone="brand"
						size="small"
						disabled={ isPublishing }
						loading={ pendingPublish === NEW_PREVIEW }
						loadingAnnouncement={ __( 'Publishing preview' ) }
						onClick={ () => publish() }
					>
						{ __( 'New preview' ) }
					</Button>
				</Dialog.Footer>
			</Dialog.Popup>
		</Dialog.Root>
	);
}
