import { __, _n, sprintf } from '@wordpress/i18n';
import { ariaKeyShortcut, displayShortcut } from '@wordpress/keycodes';
import { useEffect, useRef, useState } from 'react';
import { AnnotateHint } from '@/features/onboarding';
import { AnnotateIcon, ChevronDownIcon, TrashIcon } from '@/lib/icons';
import { isDialogOpen, isShortcut } from '@/lib/keyboard';
import { Button, IconButton, Kbd, Popover } from '@/lib/ui';
import styles from './annotation-batch.module.css';
import type { PreviewAnnotation } from '@/features/annotations';

interface AnnotationBatch {
	notes: PreviewAnnotation[];
	busy: boolean;
	onSend: () => void;
	onReview: () => boolean;
	onEdit: ( id: string ) => void;
	onClear: () => void;
	onDelete: ( id: string ) => void;
}

export function AnnotateButton( {
	active,
	disabled,
	disabledReason,
	onClick,
	batch,
}: {
	active: boolean;
	disabled: boolean;
	disabledReason?: string;
	onClick: () => void;
	batch?: AnnotationBatch;
} ) {
	const [ open, setOpen ] = useState( false );
	const editingNote = useRef( false );
	const firstNote = useRef< HTMLButtonElement >( null );
	const modeButton = useRef< HTMLButtonElement >( null );
	const notes = batch?.notes ?? [];
	const tooltip =
		disabledReason ??
		( active ? __( 'Exit annotation mode' ) : __( 'Point to anything to describe a change' ) );
	useEffect( () => {
		if ( disabled ) return;
		const toggleFromKeyboard = ( event: KeyboardEvent ) => {
			if (
				event.defaultPrevented ||
				event.repeat ||
				! isShortcut( event, '.', 'shift' ) ||
				isDialogOpen() ||
				modeButton.current?.closest( '[inert], [hidden], [aria-hidden="true"]' )
			)
				return;
			event.preventDefault();
			modeButton.current?.click();
		};
		document.addEventListener( 'keydown', toggleFromKeyboard );
		return () => document.removeEventListener( 'keydown', toggleFromKeyboard );
	}, [ disabled ] );

	const toggle = (
		<AnnotateHint
			enabled={ ! disabled && ! active && ! notes.length }
			tooltip={
				<>
					{ tooltip }
					{ ! disabled && <Kbd>{ displayShortcut.primaryShift( '.' ) }</Kbd> }
				</>
			}
		>
			<IconButton
				ref={ modeButton }
				tooltip={ false }
				variant="accent-ghost"
				size="icon-sm"
				icon={ <AnnotateIcon /> }
				label={ disabledReason ?? ( active ? __( 'Exit annotation mode' ) : __( 'Annotate' ) ) }
				aria-label={ __( 'Annotate' ) }
				aria-keyshortcuts={ ariaKeyShortcut.primaryShift( '.' ) }
				aria-pressed={ active }
				aria-description={
					disabled
						? disabledReason
						: active
						? __( 'Exit annotation mode. Your notes will be kept.' )
						: undefined
				}
				disabled={ disabled }
				focusableWhenDisabled={ false }
				tooltipSide="bottom"
				onClick={ onClick }
			/>
		</AnnotateHint>
	);
	return (
		<span className={ styles.controls }>
			{ toggle }
			{ batch && notes.length ? (
				<span className={ styles.batch }>
					<Button
						variant="accent"
						size="sm"
						className={ styles.send }
						disabled={ batch.busy }
						loading={ batch.busy }
						onClick={ batch.onSend }
						aria-label={ sprintf(
							_n( 'Send %d annotation', 'Send %d annotations', notes.length ),
							notes.length
						) }
					>
						<span className={ styles.count } aria-hidden="true">
							{ notes.length }
						</span>
						{ __( 'Send' ) }
					</Button>
					<Popover.Root
						open={ open }
						onOpenChange={ ( next ) => {
							if ( next && ! batch.onReview() ) return;
							setOpen( next );
						} }
					>
						<Popover.Trigger
							render={
								<IconButton
									variant="accent"
									size="icon-2xs"
									className={ styles.review }
									icon={ <ChevronDownIcon /> }
									label={ __( 'Review annotations' ) }
									disabled={ batch.busy }
									tooltipSide="bottom"
								/>
							}
						/>
						<Popover.Popup
							align="end"
							initialFocus={ firstNote }
							className={ styles.popup }
							aria-label={ __( 'Batched annotations' ) }
							finalFocus={ () => {
								if ( editingNote.current ) {
									editingNote.current = false;
									return false;
								}
							} }
						>
							<div className={ styles.heading }>
								<Popover.Title>
									{ sprintf( _n( '%d annotation', '%d annotations', notes.length ), notes.length ) }
								</Popover.Title>
								<Button
									variant="ghost"
									size="sm"
									disabled={ batch.busy }
									onClick={ () => {
										setOpen( false );
										batch.onClear();
										requestAnimationFrame( () => modeButton.current?.focus() );
									} }
								>
									{ __( 'Clear all' ) }
								</Button>
							</div>
							<ul className={ styles.notes }>
								{ notes.map( ( note ) => (
									<li key={ note.id } className={ styles.row }>
										<Button
											variant="ghost"
											size="sm"
											className={ styles.note }
											ref={ note.id === notes[ 0 ]?.id ? firstNote : undefined }
											aria-label={ sprintf(
												__( 'Edit annotation %d: %s' ),
												note.number,
												note.comment || __( 'Image annotation' )
											) }
											onClick={ () => {
												editingNote.current = true;
												setOpen( false );
												batch.onEdit( note.id );
											} }
										>
											<span className={ styles.number }>{ note.number }</span>
											<span className={ styles.label }>
												{ note.comment || __( 'Image annotation' ) }
											</span>
										</Button>
										<IconButton
											variant="muted-ghost"
											size="icon-2xs"
											icon={ <TrashIcon /> }
											label={ sprintf( __( 'Delete annotation %d' ), note.number ) }
											disabled={ batch.busy }
											onClick={ () => {
												if ( notes.length === 1 ) setOpen( false );
												batch.onDelete( note.id );
												requestAnimationFrame(
													() => ( firstNote.current ?? modeButton.current )?.focus()
												);
											} }
										/>
									</li>
								) ) }
							</ul>
						</Popover.Popup>
					</Popover.Root>
				</span>
			) : null }
		</span>
	);
}
