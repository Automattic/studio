import { isSnapshotExpired } from '@studio/common/lib/snapshots';
import { __, sprintf } from '@wordpress/i18n';
import { PencilIcon } from 'lucide-react';
import { useRef, useState } from 'react';
import { AccountPrompt, previewSiteImage } from '@/components/account-prompt';
import { CopyButton } from '@/components/copy-button';
import { previewExpiry, RenamePreview } from '@/components/share-dialog/preview-share-panel';
import { Button, IconButton } from '@/components/ui/button';
import {
	AlertDialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from '@/components/ui/dialog';
import { Empty } from '@/components/ui/empty';
import { Field } from '@/components/ui/field';
import { useConnector } from '@/data/core';
import { useAuthUser } from '@/data/queries/use-auth-user';
import { useDeleteSnapshot, useSnapshotUsage, useSnapshots } from '@/data/queries/use-snapshots';
import { useUserLocale } from '@/data/queries/use-user-locale';
import { TrashIcon } from '@/lib/icons/trash-icon';
import { getSnapshotHostname, getSnapshotUrl } from '@/lib/snapshot-url';
import { SettingsGroup, SettingsRow } from './rows';
import styles from './style.module.css';
import type { Snapshot } from '@/data/core';

function PreviewRow( {
	snapshot,
	onDelete,
}: {
	snapshot: Snapshot;
	onDelete: ( snapshot: Snapshot ) => void;
} ) {
	const connector = useConnector();
	const locale = useUserLocale();
	const [ renaming, setRenaming ] = useState( false );
	const expired = isSnapshotExpired( snapshot );
	const url = getSnapshotUrl( snapshot );
	if ( renaming ) {
		return (
			<Field>
				<RenamePreview snapshot={ snapshot } onDone={ () => setRenaming( false ) } />
			</Field>
		);
	}
	return (
		<SettingsRow
			title={ snapshot.name || __( 'Preview site' ) }
			description={
				<>
					{ expired ? (
						<span className={ styles.previewUrl }>{ getSnapshotHostname( snapshot ) }</span>
					) : (
						<button
							type="button"
							className={ styles.previewLink }
							title={ url }
							onClick={ () => void connector.openExternalUrl( url ) }
						>
							{ getSnapshotHostname( snapshot ) }
						</button>
					) }
					<span className={ styles.previewExpiry }>
						{ expired ? __( 'Expired' ) : previewExpiry( snapshot, locale, {} ) }
					</span>
				</>
			}
		>
			<div className={ styles.previewActions }>
				<CopyButton text={ url } label={ __( 'Copy link' ) } size="icon-sm" disabled={ expired } />
				{ expired ? null : (
					<IconButton
						variant="muted-ghost"
						size="icon-sm"
						icon={ <PencilIcon /> }
						label={ __( 'Rename preview' ) }
						onClick={ () => setRenaming( true ) }
					/>
				) }
				<IconButton
					variant="muted-ghost"
					size="icon-sm"
					icon={ <TrashIcon /> }
					label={ expired ? __( 'Remove expired preview' ) : __( 'Delete preview' ) }
					onClick={ () => onDelete( snapshot ) }
				/>
			</div>
		</SettingsRow>
	);
}

function PreviewsEmptyState() {
	return (
		<SettingsGroup>
			<SettingsRow
				title={ __( 'Share a preview of your site' ) }
				description={ __(
					'Start a site and click Share in the top right. Copy the preview link to share your work with anyone.'
				) }
			>
				<div aria-hidden="true" className={ styles.previewIllustration }>
					<div className={ styles.previewIllustrationBar }>
						<span className={ styles.previewIllustrationButton }>{ __( 'Share' ) }</span>
					</div>
					<img src={ previewSiteImage } alt="" />
				</div>
			</SettingsRow>
		</SettingsGroup>
	);
}

export function SharingPanel() {
	const connector = useConnector();
	const user = useAuthUser();
	const snapshots = useSnapshots( user.data?.id );
	const usage = useSnapshotUsage( user.data?.id );
	const remove = useDeleteSnapshot();
	const [ deleting, setDeleting ] = useState< Snapshot | null >( null );
	const [ showExpired, setShowExpired ] = useState( false );
	const cancelRef = useRef< HTMLButtonElement >( null );

	if ( user.isPending ) {
		return <div className={ styles.state }>{ __( 'Loading…' ) }</div>;
	}
	if ( ! user.data ) {
		return (
			<Empty>
				<AccountPrompt
					title={ __( 'Share your WordPress' ) }
					description={ __(
						'Create an account or log in to share previews and keep your sites in sync.'
					) }
					source="previews_tab"
				/>
			</Empty>
		);
	}

	const previews = [ ...( snapshots.data ?? [] ) ].sort( ( a, b ) => b.date - a.date );
	const live = previews.filter( ( snapshot ) => ! isSnapshotExpired( snapshot ) );
	const expired = previews.filter( isSnapshotExpired );
	return (
		<div className={ styles.preferencesPanel }>
			<SettingsGroup>
				<SettingsRow
					title={ __( 'Sharing previews on WordPress.com' ) }
					description={
						<>
							{ __(
								'Share a temporary copy of your local site with anyone. Preview sites expire seven days after their last update.'
							) }{ ' ' }
							<Button
								variant="inline-link"
								size="inline"
								onClick={ () =>
									void connector.openExternalUrl(
										'https://developer.wordpress.com/docs/developer-tools/studio/preview-sites/'
									)
								}
							>
								{ __( 'Learn more…' ) }
							</Button>
						</>
					}
					additionalContent={
						live.length
							? sprintf(
									/* translators: 1: number of live previews, 2: the account's limit. */
									__( '%1$d of %2$d preview sites used' ),
									live.length,
									usage.data?.siteLimit ?? 10
							  )
							: null
					}
				/>
			</SettingsGroup>
			{ snapshots.error ? (
				<div className={ styles.errorMessage }>{ snapshots.error.message }</div>
			) : null }
			{ snapshots.isPending ? (
				<div className={ styles.state }>{ __( 'Loading…' ) }</div>
			) : live.length ? (
				<SettingsGroup title={ __( 'Live previews' ) }>
					{ live.map( ( snapshot ) => (
						<PreviewRow
							key={ snapshot.atomicSiteId }
							snapshot={ snapshot }
							onDelete={ setDeleting }
						/>
					) ) }
				</SettingsGroup>
			) : (
				<PreviewsEmptyState />
			) }
			{ expired.length ? (
				<div>
					<Button
						variant="inline-link"
						size="inline"
						className={ styles.expiredToggle }
						aria-expanded={ showExpired }
						onClick={ () => setShowExpired( ! showExpired ) }
					>
						{ sprintf(
							/* translators: %d: number of expired previews */
							showExpired ? __( 'Hide expired previews (%d)' ) : __( 'Show expired previews (%d)' ),
							expired.length
						) }
					</Button>
					{ showExpired ? (
						<SettingsGroup title={ __( 'Expired previews' ) }>
							{ expired.map( ( snapshot ) => (
								<PreviewRow
									key={ snapshot.atomicSiteId }
									snapshot={ snapshot }
									onDelete={ setDeleting }
								/>
							) ) }
						</SettingsGroup>
					) : null }
				</div>
			) : null }
			<AlertDialog
				open={ deleting !== null }
				onOpenChange={ ( open ) => ! open && ! remove.isPending && setDeleting( null ) }
				onOpenChangeComplete={ ( open ) => ! open && remove.reset() }
			>
				<DialogContent
					layout="confirmation"
					showCloseButton={ ! remove.isPending }
					initialFocus={ cancelRef }
				>
					<DialogHeader>
						<DialogTitle>{ __( 'Delete preview' ) }</DialogTitle>
						<DialogDescription tone="default" render={ <div /> }>
							<p>
								{ sprintf(
									/* translators: %s: preview name */
									__(
										'Are you sure you want to remove the preview for “%s” from WordPress Studio?'
									),
									deleting?.name || __( 'Preview site' )
								) }
							</p>
							<p>
								{ __(
									'Anyone you’ve shared this preview with will no longer be able to view it. Your site will not be deleted.'
								) }
							</p>
						</DialogDescription>
					</DialogHeader>
					{ remove.error ? <p className={ styles.dialogError }>{ remove.error.message }</p> : null }
					<DialogFooter>
						<Button
							ref={ cancelRef }
							variant="outline"
							disabled={ remove.isPending }
							onClick={ () => setDeleting( null ) }
						>
							{ __( 'Cancel' ) }
						</Button>
						<Button
							variant="destructive"
							loading={ remove.isPending }
							onClick={ () =>
								deleting &&
								remove.mutate(
									{ hostname: getSnapshotHostname( deleting ) },
									{ onSuccess: () => setDeleting( null ) }
								)
							}
						>
							{ __( 'Delete preview' ) }
						</Button>
					</DialogFooter>
				</DialogContent>
			</AlertDialog>
		</div>
	);
}
