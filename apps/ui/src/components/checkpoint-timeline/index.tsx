import { __, sprintf } from '@wordpress/i18n';
import { backup, trash } from '@wordpress/icons';
import { Button, Dialog, Icon, IconButton } from '@wordpress/ui';
import { useMemo, useState } from 'react';
import {
	useCheckpoints,
	useCreateCheckpoint,
	useDeleteCheckpoint,
	useRestoreCheckpoint,
} from '@/data/queries/use-checkpoints';
import { formatRelativeTime } from '@/lib/format-relative-time';
import styles from './style.module.css';
import type { SiteCheckpoint, SiteCheckpointTrigger } from '@/data/core';
import type { FormEvent } from 'react';

// Display name for a checkpoint: its label when the user gave one, the tool
// the automatic pre-tool capture ran before, or a generic fallback.
export function checkpointTitle( checkpoint: {
	label?: string | null;
	toolName?: string | null;
} ): string {
	if ( checkpoint.label ) {
		return checkpoint.label;
	}
	if ( checkpoint.toolName ) {
		/* translators: %s: the agent tool an automatic checkpoint was captured before (e.g. "wp_cli") */
		return sprintf( __( 'Before %s' ), checkpoint.toolName );
	}
	return __( 'Checkpoint' );
}

function triggerLabel( trigger: SiteCheckpointTrigger ): string {
	switch ( trigger ) {
		case 'manual':
			return __( 'Manual' );
		case 'agent':
			return __( 'Agent' );
		case 'auto-pre-tool':
			return __( 'Auto' );
		case 'pre-restore':
			return __( 'Safety' );
	}
}

function formatCheckpointBytes( bytes: number ): string {
	if ( bytes < 1024 ) {
		/* translators: %d: a number of bytes */
		return sprintf( __( '%d B' ), bytes );
	}
	if ( bytes < 1024 * 1024 ) {
		/* translators: %s: a number of kilobytes */
		return sprintf( __( '%s KB' ), ( bytes / 1024 ).toFixed( 1 ) );
	}
	if ( bytes < 1024 * 1024 * 1024 ) {
		/* translators: %s: a number of megabytes */
		return sprintf( __( '%s MB' ), ( bytes / ( 1024 * 1024 ) ).toFixed( 1 ) );
	}
	/* translators: %s: a number of gigabytes */
	return sprintf( __( '%s GB' ), ( bytes / ( 1024 * 1024 * 1024 ) ).toFixed( 2 ) );
}

/**
 * Confirmation dialog for restoring a checkpoint. Shared by the timeline and
 * the chat's checkpoint chips, so both surfaces explain the same thing: the
 * restore replaces files AND database, and a safety checkpoint of the current
 * state is captured first.
 */
export function RestoreCheckpointDialog( {
	siteId,
	checkpointId,
	title,
	open,
	onOpenChange,
}: {
	siteId: string;
	checkpointId: string;
	title: string;
	open: boolean;
	onOpenChange: ( open: boolean ) => void;
} ) {
	const restoreCheckpoint = useRestoreCheckpoint();
	const [ error, setError ] = useState< string | null >( null );

	const handleConfirm = () => {
		setError( null );
		restoreCheckpoint.mutate(
			{ siteId, checkpointId },
			{
				onSuccess: () => onOpenChange( false ),
				onError: ( err: Error ) => {
					setError( err.message ?? __( 'Unable to restore the checkpoint. Please try again.' ) );
				},
			}
		);
	};

	return (
		<Dialog.Root
			open={ open }
			onOpenChange={ ( next ) => {
				if ( ! restoreCheckpoint.isPending ) {
					onOpenChange( next );
					if ( ! next ) {
						setError( null );
					}
				}
			} }
		>
			<Dialog.Popup size="small">
				<Dialog.Header>
					{ /* translators: %s: the checkpoint's name */ }
					<Dialog.Title>{ sprintf( __( 'Restore “%s”?' ), title ) }</Dialog.Title>
				</Dialog.Header>
				<Dialog.Content>
					<p className={ styles.dialogText }>
						{ __(
							'The site’s files and database will be returned to the state captured in this checkpoint. Changes made since then will be replaced.'
						) }
					</p>
					<p className={ styles.dialogText }>
						{ __(
							'A safety checkpoint of the current state is captured first, so you can undo this restore.'
						) }
					</p>
					{ error ? <div className={ styles.dialogError }>{ error }</div> : null }
				</Dialog.Content>
				<Dialog.Footer>
					<Dialog.Action variant="minimal" tone="neutral" disabled={ restoreCheckpoint.isPending }>
						{ __( 'Cancel' ) }
					</Dialog.Action>
					<Button
						variant="solid"
						tone="brand"
						loading={ restoreCheckpoint.isPending }
						loadingAnnouncement={ __( 'Restoring checkpoint' ) }
						onClick={ handleConfirm }
					>
						{ __( 'Restore checkpoint' ) }
					</Button>
				</Dialog.Footer>
			</Dialog.Popup>
		</Dialog.Root>
	);
}

// "Mark as good": capture the current site state, optionally with a label.
function CreateCheckpointDialog( {
	siteId,
	open,
	onOpenChange,
}: {
	siteId: string;
	open: boolean;
	onOpenChange: ( open: boolean ) => void;
} ) {
	const createCheckpoint = useCreateCheckpoint();
	const [ label, setLabel ] = useState( '' );
	const [ error, setError ] = useState< string | null >( null );

	const handleSubmit = ( event: FormEvent ) => {
		event.preventDefault();
		if ( createCheckpoint.isPending ) {
			return;
		}
		setError( null );
		createCheckpoint.mutate(
			{ siteId, label: label.trim() || undefined },
			{
				onSuccess: () => {
					onOpenChange( false );
					setLabel( '' );
				},
				onError: ( err: Error ) => {
					setError( err.message ?? __( 'Unable to create the checkpoint. Please try again.' ) );
				},
			}
		);
	};

	return (
		<Dialog.Root
			open={ open }
			onOpenChange={ ( next ) => {
				if ( ! createCheckpoint.isPending ) {
					onOpenChange( next );
					if ( ! next ) {
						setError( null );
					}
				}
			} }
		>
			<Dialog.Popup size="small">
				<Dialog.Header>
					<Dialog.Title>{ __( 'Create checkpoint' ) }</Dialog.Title>
				</Dialog.Header>
				<Dialog.Content>
					<form onSubmit={ handleSubmit }>
						<p className={ styles.dialogText }>
							{ __(
								'Captures the site’s files and database so you can return to this exact state later.'
							) }
						</p>
						<label className={ styles.dialogField }>
							<span>{ __( 'Label (optional)' ) }</span>
							<input
								type="text"
								value={ label }
								placeholder={ __( 'e.g. Before homepage redesign' ) }
								onChange={ ( event ) => setLabel( event.target.value ) }
								autoFocus
							/>
						</label>
						{ error ? <div className={ styles.dialogError }>{ error }</div> : null }
					</form>
				</Dialog.Content>
				<Dialog.Footer>
					<Dialog.Action variant="minimal" tone="neutral" disabled={ createCheckpoint.isPending }>
						{ __( 'Cancel' ) }
					</Dialog.Action>
					<Button
						variant="solid"
						tone="brand"
						loading={ createCheckpoint.isPending }
						loadingAnnouncement={ __( 'Creating checkpoint' ) }
						onClick={ handleSubmit }
					>
						{ __( 'Create checkpoint' ) }
					</Button>
				</Dialog.Footer>
			</Dialog.Popup>
		</Dialog.Root>
	);
}

// Confirmation before permanently removing a checkpoint. Same shape as the
// restore and delete-site dialogs.
function DeleteCheckpointDialog( {
	siteId,
	checkpoint,
	open,
	onOpenChange,
}: {
	siteId: string;
	checkpoint: SiteCheckpoint;
	open: boolean;
	onOpenChange: ( open: boolean ) => void;
} ) {
	const deleteCheckpoint = useDeleteCheckpoint();
	const [ error, setError ] = useState< string | null >( null );

	const handleConfirm = () => {
		setError( null );
		deleteCheckpoint.mutate(
			{ siteId, checkpointId: checkpoint.id },
			{
				onSuccess: () => onOpenChange( false ),
				onError: ( err: Error ) => {
					setError( err.message ?? __( 'Unable to delete the checkpoint. Please try again.' ) );
				},
			}
		);
	};

	return (
		<Dialog.Root
			open={ open }
			onOpenChange={ ( next ) => {
				if ( ! deleteCheckpoint.isPending ) {
					onOpenChange( next );
					if ( ! next ) {
						setError( null );
					}
				}
			} }
		>
			<Dialog.Popup size="small">
				<Dialog.Header>
					{ /* translators: %s: the checkpoint's name */ }
					<Dialog.Title>
						{ sprintf( __( 'Delete “%s”?' ), checkpointTitle( checkpoint ) ) }
					</Dialog.Title>
				</Dialog.Header>
				<Dialog.Content>
					<p className={ styles.dialogText }>
						{ __(
							'This save point will be permanently removed and can no longer be restored. Your site itself is not affected.'
						) }
					</p>
					{ error ? <div className={ styles.dialogError }>{ error }</div> : null }
				</Dialog.Content>
				<Dialog.Footer>
					<Dialog.Action variant="minimal" tone="neutral" disabled={ deleteCheckpoint.isPending }>
						{ __( 'Cancel' ) }
					</Dialog.Action>
					<Button
						variant="solid"
						tone="brand"
						loading={ deleteCheckpoint.isPending }
						loadingAnnouncement={ __( 'Deleting checkpoint' ) }
						onClick={ handleConfirm }
					>
						{ __( 'Delete checkpoint' ) }
					</Button>
				</Dialog.Footer>
			</Dialog.Popup>
		</Dialog.Root>
	);
}

function CheckpointRow( {
	siteId,
	checkpoint,
	onRestore,
}: {
	siteId: string;
	checkpoint: SiteCheckpoint;
	onRestore: ( checkpoint: SiteCheckpoint ) => void;
} ) {
	const [ deleteOpen, setDeleteOpen ] = useState( false );

	return (
		<li className={ styles.row }>
			<div className={ styles.rowMain }>
				<div className={ styles.rowTitleLine }>
					<span className={ styles.rowTitle }>{ checkpointTitle( checkpoint ) }</span>
				</div>
				<div className={ styles.rowMeta }>
					<span>{ triggerLabel( checkpoint.trigger ) }</span>
					<span aria-hidden="true">·</span>
					<span>{ formatRelativeTime( new Date( checkpoint.createdAt ).toISOString() ) }</span>
					<span aria-hidden="true">·</span>
					{ /* translators: %s: amount of new data this checkpoint added (e.g. "1.2 MB") */ }
					<span>
						{ sprintf(
							__( '%s new data' ),
							formatCheckpointBytes( checkpoint.stats.newObjectBytes )
						) }
					</span>
				</div>
			</div>
			<div className={ styles.rowActions }>
				<Button
					variant="minimal"
					tone="neutral"
					size="compact"
					onClick={ () => onRestore( checkpoint ) }
				>
					{ __( 'Restore' ) }
				</Button>
				<IconButton
					variant="minimal"
					tone="neutral"
					size="compact"
					icon={ trash }
					label={ __( 'Delete checkpoint' ) }
					onClick={ () => setDeleteOpen( true ) }
				/>
				<DeleteCheckpointDialog
					siteId={ siteId }
					checkpoint={ checkpoint }
					open={ deleteOpen }
					onOpenChange={ setDeleteOpen }
				/>
			</div>
		</li>
	);
}

/**
 * The site's checkpoint history: every captured save point (manual, agent,
 * automatic pre-tool, and pre-restore safety), newest first, with restore and
 * delete actions plus the "Create checkpoint" entry point.
 */
export function CheckpointTimeline( { siteId }: { siteId: string } ) {
	const { data: checkpoints, isLoading, isError } = useCheckpoints( siteId );
	const [ createOpen, setCreateOpen ] = useState( false );
	const [ restoreTarget, setRestoreTarget ] = useState< SiteCheckpoint | null >( null );

	// The index is stored oldest → newest; the timeline reads newest first.
	const orderedCheckpoints = useMemo(
		() => [ ...( checkpoints ?? [] ) ].reverse(),
		[ checkpoints ]
	);

	let content;
	if ( isLoading ) {
		content = <p className={ styles.stateText }>{ __( 'Loading checkpoints…' ) }</p>;
	} else if ( isError ) {
		content = <p className={ styles.stateText }>{ __( 'Checkpoints could not be loaded.' ) }</p>;
	} else if ( orderedCheckpoints.length === 0 ) {
		content = (
			<div className={ styles.empty }>
				<Icon icon={ backup } size={ 24 } />
				<p className={ styles.stateText }>
					{ __(
						'No checkpoints yet. Create one to capture the site’s files and database, so you can always come back to a known-good state.'
					) }
				</p>
				<Button variant="solid" tone="brand" onClick={ () => setCreateOpen( true ) }>
					{ __( 'Create checkpoint' ) }
				</Button>
			</div>
		);
	} else {
		content = (
			<ul className={ styles.list }>
				{ orderedCheckpoints.map( ( checkpoint ) => (
					<CheckpointRow
						key={ checkpoint.id }
						siteId={ siteId }
						checkpoint={ checkpoint }
						onRestore={ setRestoreTarget }
					/>
				) ) }
			</ul>
		);
	}

	return (
		<section className={ styles.root } aria-label={ __( 'Checkpoints' ) }>
			<div className={ styles.header }>
				<p className={ styles.headerDescription }>
					{ __(
						'Checkpoints capture the site’s files and database. Restore one at any time to rewind the site to that state.'
					) }
				</p>
				{ orderedCheckpoints.length > 0 ? (
					<Button variant="solid" tone="brand" onClick={ () => setCreateOpen( true ) }>
						{ __( 'Create checkpoint' ) }
					</Button>
				) : null }
			</div>
			{ content }
			<CreateCheckpointDialog
				siteId={ siteId }
				open={ createOpen }
				onOpenChange={ setCreateOpen }
			/>
			{ restoreTarget ? (
				<RestoreCheckpointDialog
					siteId={ siteId }
					checkpointId={ restoreTarget.id }
					title={ checkpointTitle( restoreTarget ) }
					open
					onOpenChange={ ( next ) => {
						if ( ! next ) {
							setRestoreTarget( null );
						}
					} }
				/>
			) : null }
		</section>
	);
}
