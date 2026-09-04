import { DAY_MS, DEMO_SITE_EXPIRATION_DAYS } from '@studio/common/constants';
import { __, _n, sprintf } from '@wordpress/i18n';
import { AlertDialog, Button, Tooltip } from '@wordpress/ui';
import { Fragment, useMemo, useState } from 'react';
import { ensureProtocol, stripProtocol } from '@/components/site-dropdown/utils';
import { useConnector } from '@/data/core';
import { useAuthUser } from '@/data/queries/use-auth-user';
import {
	useDeletePreviewSite,
	useDeletePreviewSites,
	usePublishPreviewSite,
} from '@/data/queries/use-preview-site';
import { useSnapshots, useSnapshotUsage } from '@/data/queries/use-snapshots';
import { useSiteSyncActivity } from '@/data/sync-activity';
import { useConfirmOnEnter } from '@/hooks/use-confirm-on-enter';
import { useOffline } from '@/hooks/use-offline';
import { formatRelativeTime } from '@/lib/format-relative-time';
import styles from './cards.module.css';
import {
	CardEmptyState,
	CardLoadingState,
	CardOperationProgress,
	ButtonTooltip,
	CardHeaderAction,
	CardResourceRow,
	CardRowAction,
	CardRowBadge,
	CardRows,
	CardSection,
	CardSectionFooter,
	RowDivider,
} from './overview-card';
import type { SiteDetails, Snapshot } from '@/data/core';

const LIFETIME_MS = DEMO_SITE_EXPIRATION_DAYS * DAY_MS;

export function PreviewSitesSection( { site }: { site: SiteDetails } ) {
	const { data: authUser } = useAuthUser();
	const { data: allSnapshots } = useSnapshots( authUser?.id );
	const expiredSnapshots = ( allSnapshots ?? [] ).filter(
		( snapshot ) => snapshot.localSiteId === site.id && describeLife( snapshot ).expired
	);
	const publishAction = <PreviewSitePublishAction site={ site } presentation="overview" />;

	return (
		<CardSection>
			<PreviewSitesList site={ site } />
			{ authUser ? (
				<CardSectionFooter>
					{ publishAction }
					{ expiredSnapshots.length ? (
						<DeleteExpiredPreviewSitesAction snapshots={ expiredSnapshots } />
					) : null }
				</CardSectionFooter>
			) : null }
		</CardSection>
	);
}

function DeleteExpiredPreviewSitesAction( { snapshots }: { snapshots: Snapshot[] } ) {
	const isOffline = useOffline();
	const deletePreviewSites = useDeletePreviewSites();
	const [ confirmOpen, setConfirmOpen ] = useState( false );
	const confirmLabel = __( 'Delete all expired' );
	const handleConfirmKeyDown = useConfirmOnEnter( confirmLabel );
	const count = snapshots.length;

	return (
		<>
			<ButtonTooltip tooltip={ __( 'Permanently delete all expired preview sites' ) }>
				<Button
					variant="minimal"
					tone="neutral"
					size="small"
					className={ styles.footerDestructiveAction }
					disabled={ deletePreviewSites.isPending || isOffline }
					onClick={ () => setConfirmOpen( true ) }
				>
					{ deletePreviewSites.isPending ? __( 'Deleting expired…' ) : confirmLabel }
				</Button>
			</ButtonTooltip>
			<AlertDialog.Root
				open={ confirmOpen }
				onOpenChange={ setConfirmOpen }
				onConfirm={ async () => {
					try {
						await deletePreviewSites.mutateAsync(
							snapshots.map( ( snapshot ) => stripProtocol( snapshot.url ) )
						);
					} catch ( error ) {
						return {
							error:
								error instanceof Error
									? error.message
									: __( 'Unable to delete the expired previews. Please try again.' ),
						};
					}
				} }
			>
				<AlertDialog.Popup
					onKeyDown={ handleConfirmKeyDown }
					intent="irreversible"
					title={ __( 'Delete all expired previews?' ) }
					description={ sprintf(
						_n(
							'This will permanently delete %d expired preview site and its URL.',
							'This will permanently delete %d expired preview sites and their URLs.',
							count
						),
						count
					) }
					confirmButtonText={ confirmLabel }
				/>
			</AlertDialog.Root>
		</>
	);
}

export function PreviewSitePublishAction( {
	site,
	presentation,
}: {
	site: SiteDetails;
	presentation: 'overview' | 'dialog';
} ) {
	const { data: authUser } = useAuthUser();
	const isOffline = useOffline();
	const { data: usage } = useSnapshotUsage( authUser?.id );
	const publishPreviewSite = usePublishPreviewSite();

	if ( ! authUser ) {
		return null;
	}

	const disabled = publishPreviewSite.isPending || isOffline || usage?.siteCreationBlocked === true;
	const publish = () => publishPreviewSite.mutate( { siteId: site.id } );
	const tooltip = isOffline
		? __( 'Creating a preview requires an internet connection' )
		: usage?.siteCreationBlocked
		? __( 'Your account has reached its preview site limit' )
		: publishPreviewSite.isPending
		? __( 'A preview is currently being published' )
		: __( 'Create a shareable preview site' );

	if ( presentation === 'dialog' ) {
		return (
			<ButtonTooltip tooltip={ tooltip }>
				<Button
					variant="minimal"
					tone="brand"
					size="small"
					disabled={ disabled }
					loading={ publishPreviewSite.isPending }
					loadingAnnouncement={ __( 'Publishing preview site' ) }
					onClick={ publish }
				>
					{ __( 'New preview' ) }
				</Button>
			</ButtonTooltip>
		);
	}

	return (
		<div className={ styles.headerActions }>
			<CardHeaderAction
				tooltip={ tooltip }
				disabled={ disabled }
				loading={ publishPreviewSite.isPending }
				loadingAnnouncement={ __( 'Publishing preview site' ) }
				onClick={ publish }
			>
				{ __( 'New preview' ) }
			</CardHeaderAction>
			{ usage && usage.siteLimit > 0 ? (
				<Tooltip.Root>
					<Tooltip.Trigger
						render={
							<span className={ styles.headerMeta }>
								{ sprintf(
									// translators: 1: previews in use, 2: total previews allowed.
									__( '%1$d of %2$d' ),
									usage.siteCount,
									usage.siteLimit
								) }
							</span>
						}
					/>
					<Tooltip.Popup positioner={ <Tooltip.Positioner side="top" /> }>
						{ sprintf(
							// translators: 1: previews in use, 2: total previews allowed.
							__( '%1$d of %2$d preview sites used on your account' ),
							usage.siteCount,
							usage.siteLimit
						) }
					</Tooltip.Popup>
				</Tooltip.Root>
			) : null }
		</div>
	);
}

export function PreviewSitesList( { site }: { site: SiteDetails } ) {
	const { data: authUser } = useAuthUser();
	const { data: allSnapshots, isLoading } = useSnapshots( authUser?.id );
	const snapshots = useMemo(
		() =>
			( allSnapshots ?? [] )
				.filter( ( snapshot ) => snapshot.localSiteId === site.id )
				.sort( ( a, b ) => b.date - a.date ),
		[ allSnapshots, site.id ]
	);
	const activity = useSiteSyncActivity( site.id );
	const pendingPreview =
		activity?.kind === 'pending' && activity.direction === 'preview' ? activity : null;

	return (
		<>
			{ ! authUser ? (
				<CardEmptyState>
					{ __( 'Sign in to publish a preview site and share your work.' ) }
				</CardEmptyState>
			) : isLoading && ! allSnapshots ? (
				<CardLoadingState label={ __( 'Loading preview sites…' ) } />
			) : ! snapshots.length && ! pendingPreview ? (
				<CardEmptyState>
					{ sprintf(
						// translators: %d: number of days a preview site stays online.
						_n(
							'No preview site yet. Publishing one gives you a shareable link for %d day.',
							'No preview site yet. Publishing one gives you a shareable link for %d days.',
							DEMO_SITE_EXPIRATION_DAYS
						),
						DEMO_SITE_EXPIRATION_DAYS
					) }
				</CardEmptyState>
			) : (
				<CardRows>
					{ pendingPreview && (
						<>
							<PreviewPublishingRow
								message={ pendingPreview.message ?? __( 'Preparing site…' ) }
								progress={ pendingPreview.progress ?? 5 }
							/>
							{ snapshots.length > 0 && <RowDivider /> }
						</>
					) }
					{ snapshots.map( ( snapshot, index ) => (
						<Fragment key={ snapshot.url }>
							{ index > 0 && <RowDivider /> }
							<PreviewRow site={ site } snapshot={ snapshot } />
						</Fragment>
					) ) }
				</CardRows>
			) }
		</>
	);
}

function PreviewPublishingRow( { message, progress }: { message: string; progress: number } ) {
	return (
		<CardResourceRow
			label={ __( 'New preview' ) }
			actions={
				<CardOperationProgress
					label={ __( 'Publishing preview' ) }
					message={ message }
					progress={ progress }
				/>
			}
			status={ <CardRowBadge intent="medium">{ __( 'In progress' ) }</CardRowBadge> }
		/>
	);
}

function PreviewRow( { site, snapshot }: { site: SiteDetails; snapshot: Snapshot } ) {
	const connector = useConnector();
	const isOffline = useOffline();
	const publishPreviewSite = usePublishPreviewSite();
	const deletePreviewSite = useDeletePreviewSite();
	const [ deleteOpen, setDeleteOpen ] = useState( false );
	const life = describeLife( snapshot );
	const url = ensureProtocol( snapshot.url );
	const hostname = stripProtocol( snapshot.url );
	const confirmDeleteLabel = __( 'Delete preview' );
	const handleDeleteKeyDown = useConfirmOnEnter( confirmDeleteLabel );
	const published = sprintf(
		__( 'Published %s ago' ),
		formatRelativeTime( new Date( snapshot.date ).toISOString() )
	);

	const republish = () =>
		publishPreviewSite.mutate( {
			siteId: site.id,
			existingHostname: life.expired ? undefined : stripProtocol( snapshot.url ),
		} );

	return (
		<>
			<CardResourceRow
				label={ stripProtocol( snapshot.url ) }
				url={ url }
				meta={ published }
				expired={ life.expired }
				actions={
					<>
						{ ! life.expired && (
							<CardRowAction
								type="button"
								tooltip={ __( 'Open this preview site' ) }
								onClick={ () => void connector.openExternalUrl( url ) }
							>
								{ __( 'Open' ) }
							</CardRowAction>
						) }
						<CardRowAction
							type="button"
							tooltip={
								life.expired
									? __( 'Create a new preview from this local site' )
									: __( 'Update this preview with local changes' )
							}
							disabled={ publishPreviewSite.isPending || isOffline }
							onClick={ republish }
						>
							{ publishPreviewSite.isPending
								? __( 'Publishing…' )
								: life.expired
								? __( 'Republish' )
								: __( 'Update' ) }
						</CardRowAction>
						{ ! life.expired && (
							<CardRowAction
								type="button"
								tooltip={ __( 'Copy the preview URL' ) }
								onClick={ () => void connector.copyText( url ) }
							>
								{ __( 'Copy URL' ) }
							</CardRowAction>
						) }
						<CardRowAction
							type="button"
							className={ styles.rowActionDestructive }
							tooltip={ __( 'Permanently delete this preview site' ) }
							disabled={ deletePreviewSite.isPending || publishPreviewSite.isPending || isOffline }
							onClick={ () => setDeleteOpen( true ) }
						>
							{ __( 'Delete' ) }
						</CardRowAction>
					</>
				}
				status={
					<CardRowBadge intent={ life.expired ? 'high' : life.endingSoon ? 'medium' : 'stable' }>
						{ life.label }
					</CardRowBadge>
				}
			/>
			<AlertDialog.Root
				open={ deleteOpen }
				onOpenChange={ setDeleteOpen }
				onConfirm={ async () => {
					try {
						await deletePreviewSite.mutateAsync( { hostname } );
					} catch ( error ) {
						return {
							error:
								error instanceof Error
									? error.message
									: __( 'Unable to delete the preview. Please try again.' ),
						};
					}
				} }
			>
				<AlertDialog.Popup
					onKeyDown={ handleDeleteKeyDown }
					intent="irreversible"
					title={ sprintf( __( 'Delete %s?' ), hostname ) }
					description={ __(
						'This preview site and its shareable URL will be permanently deleted.'
					) }
					confirmButtonText={ confirmDeleteLabel }
				/>
			</AlertDialog.Root>
		</>
	);
}

function describeLife( snapshot: Snapshot ): {
	label: string;
	endingSoon: boolean;
	expired: boolean;
} {
	const remainingMs = snapshot.date + LIFETIME_MS - Date.now();
	if ( remainingMs <= 0 ) {
		return { label: __( 'Expired' ), endingSoon: false, expired: true };
	}

	const remainingDays = Math.ceil( remainingMs / DAY_MS );
	return {
		label: sprintf(
			// translators: %d: number of days until a preview site expires.
			_n( 'Expires in %d day', 'Expires in %d days', remainingDays ),
			remainingDays
		),
		endingSoon: remainingMs <= DAY_MS,
		expired: false,
	};
}
