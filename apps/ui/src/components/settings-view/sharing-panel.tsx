import { isSnapshotExpired } from '@studio/common/lib/snapshots';
import { __, sprintf } from '@wordpress/i18n';
import { check, copy, pencil, trash } from '@wordpress/icons';
import { AlertDialog, IconButton } from '@wordpress/ui';
import { useState } from 'react';
import { AccountPrompt, previewSiteImage } from '@/components/account-prompt';
import { previewExpiry, RenamePreview } from '@/components/share-dialog/preview-share-panel';
import { useConnector } from '@/data/core';
import { useAuthUser } from '@/data/queries/use-auth-user';
import { useDeleteSnapshot, useSnapshotUsage, useSnapshots } from '@/data/queries/use-snapshots';
import { useUserLocale } from '@/data/queries/use-user-locale';
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
	const [ copied, setCopied ] = useState( false );
	const [ renaming, setRenaming ] = useState( false );
	const expired = isSnapshotExpired( snapshot );
	const url = getSnapshotUrl( snapshot );
	if ( renaming ) {
		return (
			<div className={ styles.previewRename }>
				<RenamePreview snapshot={ snapshot } onDone={ () => setRenaming( false ) } />
			</div>
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
						{ expired ? __( 'Expired' ) : previewExpiry( snapshot, locale ) }
					</span>
				</>
			}
		>
			<div className={ styles.previewActions }>
				<IconButton
					variant="minimal"
					tone="neutral"
					size="compact"
					icon={ copied ? check : copy }
					label={ copied ? __( 'Copied' ) : __( 'Copy link' ) }
					disabled={ expired }
					onClick={ () =>
						void connector.copyText( url ).then( () => {
							setCopied( true );
							setTimeout( () => setCopied( false ), 1500 );
						} )
					}
				/>
				{ expired ? null : (
					<IconButton
						variant="minimal"
						tone="neutral"
						size="compact"
						icon={ pencil }
						label={ __( 'Rename preview' ) }
						onClick={ () => setRenaming( true ) }
					/>
				) }
				<IconButton
					variant="minimal"
					tone="neutral"
					size="compact"
					icon={ trash }
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

	if ( user.isPending ) {
		return <div className={ styles.state }>{ __( 'Loading…' ) }</div>;
	}
	if ( ! user.data ) {
		return (
			<AccountPrompt
				title={ __( 'Share your WordPress' ) }
				description={ __(
					'Create an account or log in to share previews and keep your sites in sync.'
				) }
				source="previews_tab"
			/>
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
							<button
								type="button"
								className={ styles.inlineLink }
								onClick={ () =>
									void connector.openExternalUrl(
										'https://developer.wordpress.com/docs/developer-tools/studio/preview-sites/'
									)
								}
							>
								{ __( 'Learn more…' ) }
							</button>
							{ live.length ? (
								<span className={ styles.previewUsage }>
									{ sprintf(
										/* translators: 1: number of live previews, 2: the account's limit. */
										__( '%1$d of %2$d preview sites used' ),
										live.length,
										usage.data?.siteLimit ?? 10
									) }
								</span>
							) : null }
						</>
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
				<div className={ styles.previewExpired }>
					<button
						type="button"
						className={ styles.inlineLink }
						aria-expanded={ showExpired }
						onClick={ () => setShowExpired( ! showExpired ) }
					>
						{ sprintf(
							/* translators: %d: number of expired previews */
							showExpired ? __( 'Hide expired previews (%d)' ) : __( 'Show expired previews (%d)' ),
							expired.length
						) }
					</button>
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
			<AlertDialog.Root
				open={ deleting !== null }
				onOpenChange={ ( open ) => ! open && setDeleting( null ) }
				onConfirm={ async () => {
					try {
						if ( deleting ) {
							await remove.mutateAsync( { hostname: getSnapshotHostname( deleting ) } );
						}
					} catch ( error ) {
						return { error: error instanceof Error ? error.message : String( error ) };
					}
				} }
			>
				<AlertDialog.Popup
					intent="irreversible"
					title={ __( 'Delete preview' ) }
					description={ sprintf(
						/* translators: %s: preview name */
						__(
							'Anyone you’ve shared “%s” with will no longer be able to view it. Your site will not be deleted.'
						),
						deleting?.name || __( 'Preview site' )
					) }
					confirmButtonText={ __( 'Delete preview' ) }
				/>
			</AlertDialog.Root>
		</div>
	);
}
