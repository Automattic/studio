import { isSnapshotExpired } from '@studio/common/lib/snapshots';
import { __, sprintf } from '@wordpress/i18n';
import {
	arrowUp,
	check,
	close,
	copy,
	external,
	Icon,
	moreHorizontal,
	rotateRight,
	scheduled,
	trash,
} from '@wordpress/icons';
import { Button, IconButton } from '@wordpress/ui';
import { clsx } from 'clsx';
import { useState } from 'react';
import * as Menu from '@/components/menu';
import { useConnector } from '@/data/core';
import { usePublishPreviewSite } from '@/data/queries/use-preview-site';
import { useDeleteSnapshot, useRenameSnapshot } from '@/data/queries/use-snapshots';
import { EnvironmentSection } from './environment-section';
import styles from './environment-section.module.css';
import {
	ensureProtocol,
	getSnapshotExpiredLabel,
	getSnapshotHostname,
	getSnapshotTimesLabel,
	stripProtocol,
} from './utils';
import type { SiteDetails, Snapshot } from '@/data/core';
import type { SyncActivity } from '@/data/sync-activity';

type PreviewActivity = Extract< SyncActivity, { kind: 'pending' } >;

type Props = {
	site: SiteDetails;
	snapshots: Snapshot[];
	activity: SyncActivity | null;
	notice: string | null;
	canPublish: boolean;
	canCreate: boolean;
	getPublishLabel: ( idle: string ) => string;
};

type Editing = { hostname: string; mode: 'rename' | 'delete' } | null;

export function PreviewsSection( {
	site,
	snapshots: listedSnapshots,
	activity,
	notice,
	canPublish,
	canCreate,
	getPublishLabel,
}: Props ) {
	const connector = useConnector();
	const publishPreviewSite = usePublishPreviewSite();
	const deleteSnapshot = useDeleteSnapshot();
	const renameSnapshot = useRenameSnapshot();
	const [ editing, setEditing ] = useState< Editing >( null );

	// Until the CLI's event updates the list, show what this window asked for.
	const deleting = deleteSnapshot.isPending ? deleteSnapshot.variables.hostname : undefined;
	const renaming = renameSnapshot.isPending ? renameSnapshot.variables : undefined;
	const snapshots = listedSnapshots
		.filter( ( snapshot ) => snapshot.url !== deleting )
		.map( ( snapshot ) =>
			snapshot.url === renaming?.hostname ? { ...snapshot, name: renaming.name } : snapshot
		);

	const pending =
		activity?.kind === 'pending' && activity.direction === 'preview' ? activity : null;
	const updatingHostname = snapshots.some( ( snapshot ) => snapshot.url === pending?.hostname )
		? pending?.hostname
		: undefined;
	const isCreating = pending !== null && ! updatingHostname;

	// Success can arrive before the new preview does; hold the progress until it's listed.
	const [ creation, setCreation ] = useState< {
		knownUrls: string[];
		activity: PreviewActivity;
	} | null >( null );
	const awaitingNewPreview =
		! isCreating &&
		creation !== null &&
		activity?.kind === 'success' &&
		activity.direction === 'preview' &&
		snapshots.every( ( snapshot ) => creation.knownUrls.includes( snapshot.url ) );
	if ( isCreating && creation?.activity !== pending ) {
		setCreation( {
			knownUrls: creation?.knownUrls ?? snapshots.map( ( snapshot ) => snapshot.url ),
			activity: pending,
		} );
	} else if ( ! isCreating && ! awaitingNewPreview && creation !== null ) {
		setCreation( null );
	}
	const creatingActivity = isCreating
		? pending
		: awaitingNewPreview && creation
		? { ...creation.activity, progress: 100 }
		: null;

	const openExternal = ( url: string ) => void connector.openExternalUrl( url );

	const publish = ( existingHostname?: string, name?: string, onPublished?: () => void ) => {
		publishPreviewSite.mutate(
			{ siteId: site.id, existingHostname, name },
			{
				onSuccess: ( { url } ) => {
					onPublished?.();
					openExternal( ensureProtocol( url ) );
				},
			}
		);
	};

	return (
		<EnvironmentSection
			title={ __( 'Previews' ) }
			count={ snapshots.length }
			actionLabel={ __( 'New preview' ) }
			actionDisabled={ ! canPublish || ! canCreate || pending !== null }
			onAction={ () => publish() }
			status={
				creatingActivity ? (
					<div className={ styles.creating } role="status" aria-live="polite">
						<PreviewProgress activity={ creatingActivity } />
					</div>
				) : (
					notice
				)
			}
		>
			{ snapshots.map( ( snapshot ) => {
				if ( snapshot.url === updatingHostname && pending ) {
					return (
						<PreviewProgressRow
							key={ snapshot.url }
							name={ getSnapshotName( snapshot, site ) }
							activity={ pending }
						/>
					);
				}
				if ( editing?.hostname === snapshot.url && editing.mode === 'delete' ) {
					return (
						<DeleteConfirmRow
							key={ snapshot.url }
							name={ getSnapshotName( snapshot, site ) }
							onCancel={ () => setEditing( null ) }
							onConfirm={ () => {
								setEditing( null );
								deleteSnapshot.mutate( { hostname: snapshot.url } );
							} }
						/>
					);
				}
				return (
					<PreviewRow
						key={ snapshot.url }
						site={ site }
						snapshot={ snapshot }
						renaming={ editing?.hostname === snapshot.url && editing.mode === 'rename' }
						canPublish={ canPublish && pending === null }
						canRecreate={ canCreate }
						getPublishLabel={ getPublishLabel }
						onOpen={ () => openExternal( ensureProtocol( snapshot.url ) ) }
						onCopy={ () =>
							void connector.copyText( ensureProtocol( snapshot.url ) ).catch( ( error ) => {
								console.error( 'Failed to copy preview URL:', error );
							} )
						}
						onUpdate={ () => publish( getSnapshotHostname( snapshot ) ) }
						// The CLI can't refresh an expired preview, so replace it.
						onRecreate={ () =>
							publish( undefined, snapshot.name, () =>
								deleteSnapshot.mutate( { hostname: snapshot.url } )
							)
						}
						onDelete={ () => deleteSnapshot.mutate( { hostname: snapshot.url } ) }
						onStartRename={ () => setEditing( { hostname: snapshot.url, mode: 'rename' } ) }
						onStartDelete={ () => setEditing( { hostname: snapshot.url, mode: 'delete' } ) }
						onRename={ ( name ) => {
							setEditing( null );
							if ( name !== snapshot.name ) {
								renameSnapshot.mutate( { hostname: snapshot.url, name } );
							}
						} }
						onCancelEdit={ () => setEditing( null ) }
					/>
				);
			} ) }
		</EnvironmentSection>
	);
}

function getSnapshotName( snapshot: Snapshot, site: SiteDetails ): string {
	// translators: %s: Site name (e.g. "My Site Preview")
	return snapshot.name || sprintf( __( '%s Preview' ), site.name );
}

function PreviewRow( {
	site,
	snapshot,
	renaming,
	canPublish,
	canRecreate,
	getPublishLabel,
	onOpen,
	onCopy,
	onUpdate,
	onRecreate,
	onDelete,
	onStartRename,
	onStartDelete,
	onRename,
	onCancelEdit,
}: {
	site: SiteDetails;
	snapshot: Snapshot;
	renaming: boolean;
	canPublish: boolean;
	canRecreate: boolean;
	getPublishLabel: ( idle: string ) => string;
	onOpen: () => void;
	onCopy: () => void;
	onUpdate: () => void;
	onRecreate: () => void;
	onDelete: () => void;
	onStartRename: () => void;
	onStartDelete: () => void;
	onRename: ( name: string ) => void;
	onCancelEdit: () => void;
} ) {
	const [ menuOpen, setMenuOpen ] = useState( false );
	const name = getSnapshotName( snapshot, site );
	const expired = isSnapshotExpired( snapshot );
	const hostname = stripProtocol( snapshot.url );

	if ( renaming ) {
		return (
			<RenameRow
				initialName={ name }
				hostname={ hostname }
				meta={ getSnapshotTimesLabel( snapshot ) }
				onSubmit={ onRename }
				onCancel={ onCancelEdit }
			/>
		);
	}

	return (
		<div className={ clsx( styles.row, expired && styles.row_expired ) }>
			<div className={ styles.rowText }>
				<div className={ styles.name }>{ name }</div>
				{ expired ? (
					<>
						<div className={ clsx( styles.url, styles.url_expired ) }>{ hostname }</div>
						<div className={ clsx( styles.meta, styles.meta_expired ) }>
							<Icon icon={ scheduled } size={ 14 } aria-hidden="true" />
							{ getSnapshotExpiredLabel( snapshot ) }
						</div>
					</>
				) : (
					<>
						<button
							type="button"
							className={ styles.url }
							aria-label={ sprintf(
								/* translators: %s: preview site name */
								__( 'Open %s in your browser' ),
								name
							) }
							onClick={ onOpen }
						>
							<span>{ hostname }</span>
							<Icon icon={ external } size={ 12 } aria-hidden="true" />
						</button>
						<div className={ styles.meta } title={ getSnapshotTimesLabel( snapshot ) }>
							{ getSnapshotTimesLabel( snapshot ) }
						</div>
					</>
				) }
			</div>
			<div className={ styles.actions }>
				{ expired ? (
					<>
						<IconButton
							variant="minimal"
							tone="neutral"
							size="small"
							icon={ rotateRight }
							label={ getPublishLabel( __( 'Recreate preview' ) ) }
							className={ styles.actionButton }
							disabled={ ! canPublish || ! canRecreate }
							focusableWhenDisabled
							onClick={ onRecreate }
						/>
						<IconButton
							variant="minimal"
							tone="neutral"
							size="small"
							icon={ trash }
							label={ __( 'Remove expired preview' ) }
							className={ clsx( styles.actionButton, styles.actionButton_destructive ) }
							onClick={ onDelete }
						/>
					</>
				) : (
					<>
						<IconButton
							variant="minimal"
							tone="neutral"
							size="small"
							icon={ copy }
							label={ __( 'Copy preview URL' ) }
							className={ styles.actionButton }
							onClick={ onCopy }
						/>
						<IconButton
							variant="minimal"
							tone="neutral"
							size="small"
							icon={ arrowUp }
							label={ getPublishLabel( __( 'Update preview site' ) ) }
							className={ styles.actionButton }
							disabled={ ! canPublish }
							focusableWhenDisabled
							onClick={ onUpdate }
						/>
						<Menu.SubmenuRoot open={ menuOpen } onOpenChange={ setMenuOpen }>
							<Menu.SubmenuTrigger
								className={ styles.moreMenuTrigger }
								aria-label={ sprintf(
									/* translators: %s: preview site name */
									__( 'More actions for %s' ),
									name
								) }
							>
								<Icon icon={ moreHorizontal } size={ 16 } aria-hidden="true" />
							</Menu.SubmenuTrigger>
							<Menu.Popup side="right" align="start" className={ styles.moreMenuPopup }>
								<Menu.Item
									closeOnClick={ false }
									onClick={ () => {
										setMenuOpen( false );
										onStartRename();
									} }
								>
									{ __( 'Rename' ) }
								</Menu.Item>
								<Menu.Item
									destructive
									closeOnClick={ false }
									onClick={ () => {
										setMenuOpen( false );
										onStartDelete();
									} }
								>
									{ __( 'Delete' ) }
								</Menu.Item>
							</Menu.Popup>
						</Menu.SubmenuRoot>
					</>
				) }
			</div>
		</div>
	);
}

function RenameRow( {
	initialName,
	hostname,
	meta,
	onSubmit,
	onCancel,
}: {
	initialName: string;
	hostname: string;
	meta: string;
	onSubmit: ( name: string ) => void;
	onCancel: () => void;
} ) {
	const [ value, setValue ] = useState( initialName );
	const trimmed = value.trim();
	const canSave = trimmed !== '' && trimmed !== initialName;

	return (
		<form
			className={ clsx( styles.row, styles.row_active ) }
			onSubmit={ ( event ) => {
				event.preventDefault();
				if ( canSave ) {
					onSubmit( trimmed );
				}
			} }
		>
			<div className={ styles.rowText }>
				<input
					className={ styles.nameInput }
					aria-label={ __( 'Preview name' ) }
					value={ value }
					autoFocus
					onFocus={ ( event ) => event.currentTarget.select() }
					onChange={ ( event ) => setValue( event.target.value ) }
					onKeyDown={ ( event ) => {
						// Keep keys away from the menu, whose typeahead and Escape
						// handling would otherwise steal them from the field.
						event.stopPropagation();
						if ( event.key === 'Escape' ) {
							onCancel();
						}
					} }
				/>
				<div className={ styles.url }>
					<span>{ hostname }</span>
				</div>
				<div className={ styles.meta }>{ meta }</div>
			</div>
			<div className={ styles.actions }>
				{ canSave ? (
					<IconButton
						type="submit"
						variant="minimal"
						tone="neutral"
						size="small"
						icon={ check }
						label={ __( 'Save name' ) }
						className={ clsx( styles.actionButton, styles.actionButton_confirm ) }
					/>
				) : null }
				<IconButton
					variant="minimal"
					tone="neutral"
					size="small"
					icon={ close }
					label={ __( 'Cancel renaming' ) }
					className={ styles.actionButton }
					onClick={ onCancel }
				/>
			</div>
		</form>
	);
}

function DeleteConfirmRow( {
	name,
	onCancel,
	onConfirm,
}: {
	name: string;
	onCancel: () => void;
	onConfirm: () => void;
} ) {
	return (
		<div className={ clsx( styles.row, styles.row_danger ) } role="group">
			<div className={ styles.rowText }>
				<div className={ styles.name }>{ __( 'Delete this preview?' ) }</div>
				<div className={ styles.meta }>{ name }</div>
			</div>
			<div className={ styles.confirmActions }>
				<Button
					variant="outline"
					tone="neutral"
					size="compact"
					className={ styles.cancelButton }
					autoFocus
					onClick={ onCancel }
				>
					{ __( 'Cancel' ) }
				</Button>
				<Button
					variant="solid"
					size="compact"
					className={ styles.deleteButton }
					onClick={ onConfirm }
				>
					{ __( 'Delete' ) }
				</Button>
			</div>
		</div>
	);
}

function PreviewProgress( { activity }: { activity: PreviewActivity } ) {
	return (
		<>
			<div className={ styles.meta }>{ activity.message ?? __( 'Preparing preview…' ) }</div>
			<div className={ styles.progressTrack } aria-hidden="true">
				<div
					className={ styles.progressBar }
					style={ { width: `${ Math.max( 2, activity.progress ?? 0 ) }%` } }
				/>
			</div>
		</>
	);
}

function PreviewProgressRow( { name, activity }: { name: string; activity: PreviewActivity } ) {
	return (
		<div className={ clsx( styles.row, styles.row_active ) }>
			<div className={ styles.rowText } role="status" aria-live="polite">
				<div className={ styles.name }>{ name }</div>
				<PreviewProgress activity={ activity } />
			</div>
		</div>
	);
}
