import { __, _n, sprintf } from '@wordpress/i18n';
import { useRef, useState } from 'react';
import { AnnotateIcon, ChevronDownIcon } from '@/lib/icons';
import { Button, IconButton, Popover } from '@/lib/ui';
import styles from './annotation-batch.module.css';
import type { PreviewAnnotation } from '@/features/annotations';

interface AnnotationBatch {
	notes: PreviewAnnotation[];
	busy: boolean;
	onSend: () => void;
	onReview: () => boolean;
	onEdit: ( id: string ) => void;
	onClear: () => void;
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
	const notes = batch?.notes ?? [];
	if ( batch && notes.length ) {
		return (
			<span className={ styles.control }>
				<Button
					variant="accent"
					size="header"
					className={ styles.send }
					disabled={ batch.busy }
					loading={ batch.busy }
					onClick={ batch.onSend }
					aria-label={ sprintf(
						_n( 'Send %d annotation', 'Send %d annotations', notes.length ),
						notes.length
					) }
				>
					{ __( 'Send' ) } <span className={ styles.count }>{ notes.length }</span>
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
								size="icon-sm"
								className={ styles.dropdown }
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
								size="header"
								disabled={ batch.busy }
								onClick={ () => {
									setOpen( false );
									batch.onClear();
								} }
							>
								{ __( 'Clear all' ) }
							</Button>
						</div>
						<ul className={ styles.notes }>
							{ notes.map( ( note ) => (
								<li key={ note.id }>
									<Button
										variant="ghost"
										size="header"
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
								</li>
							) ) }
						</ul>
					</Popover.Popup>
				</Popover.Root>
			</span>
		);
	}
	return (
		<IconButton
			variant="accent-ghost"
			size="icon-sm"
			icon={ <AnnotateIcon /> }
			label={ disabledReason ?? ( active ? __( 'Exit annotation mode' ) : __( 'Annotate' ) ) }
			aria-label={ __( 'Annotate' ) }
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
	);
}
