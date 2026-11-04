import { __, sprintf } from '@wordpress/i18n';
import { useLayoutEffect, useRef, useState } from 'react';
import { useOptionalSessionPreviewUI } from '@/data/use-session-ui';
import { AnnotateIcon, TrashIcon } from '@/lib/icons';
import { AttachmentChip, AttachmentRemoveButton, Button, IconButton, Popover } from '@/lib/ui';
import styles from './review-chip.module.css';
import {
	isAnnotationsBusy,
	isStagedAnnotation,
	removeAnnotations,
	requestAnnotationReview,
	useSiteAnnotations,
} from './store';
import type { CSSProperties } from 'react';

export function AnnotationReviewChip( {
	siteId,
	label,
	description,
	onRemove,
}: {
	siteId: string;
	label: string;
	description: string;
	onRemove: () => void;
} ) {
	const annotations = useSiteAnnotations( siteId );
	const notes = annotations.notes.filter( isStagedAnnotation );
	const busy = isAnnotationsBusy( annotations );
	const preview = useOptionalSessionPreviewUI();
	const [ open, setOpen ] = useState( false );
	const editing = useRef( false );
	const list = useRef< HTMLDivElement >( null );
	const trigger = useRef< HTMLButtonElement >( null );
	const [ maxWidth, setMaxWidth ] = useState< number >();
	useLayoutEffect( () => {
		const chip = trigger.current;
		const composer = chip?.closest< HTMLElement >( '[data-slot="input-group"]' );
		if ( ! open || ! chip || ! composer ) return;
		const measure = () => {
			const bounds = composer.getBoundingClientRect();
			const attachments = chip.closest( 'ul' ) ?? chip;
			const anchor = attachments.getBoundingClientRect();
			const inset =
				( getComputedStyle( composer ).direction === 'rtl'
					? bounds.right - anchor.right
					: anchor.left - bounds.left ) +
				( parseFloat( getComputedStyle( attachments ).paddingInlineStart ) || 0 );
			setMaxWidth( Math.max( 0, bounds.width - 2 * inset ) );
		};
		measure();
		const observer = new ResizeObserver( measure );
		observer.observe( composer );
		observer.observe( chip );
		return () => observer.disconnect();
	}, [ open ] );
	return (
		<AttachmentChip className={ styles.chip } render={ <li /> } aria-label={ description }>
			<Popover.Root
				open={ open }
				onOpenChange={ ( next ) => {
					if ( next ) editing.current = false;
					setOpen( next );
				} }
			>
				<Popover.Trigger
					render={
						<Button
							ref={ trigger }
							className={ styles.trigger }
							variant="ghost"
							disabled={ busy }
							aria-label={ label }
						/>
					}
				>
					<AnnotateIcon />
					<span className={ styles.label }>{ label }</span>
				</Popover.Trigger>
				<Popover.Popup
					side="top"
					className={ styles.popup }
					style={
						maxWidth === undefined
							? undefined
							: ( { '--annotation-popup-max-width': `${ maxWidth }px` } as CSSProperties )
					}
					aria-label={ __( 'Annotations' ) }
					initialFocus={ ( interactionType ) =>
						interactionType === 'keyboard'
							? list.current?.querySelector< HTMLButtonElement >( '[data-annotation-edit]' ) ??
							  false
							: false
					}
					finalFocus={ () => ( editing.current ? false : trigger.current ?? false ) }
				>
					<div
						ref={ list }
						className={ styles.notes }
						onKeyDown={ ( event ) => {
							if ( ! [ 'ArrowDown', 'ArrowUp', 'Home', 'End' ].includes( event.key ) ) return;
							const buttons = Array.from(
								event.currentTarget.querySelectorAll< HTMLButtonElement >(
									'[data-annotation-edit]:not(:disabled)'
								)
							);
							const index = buttons.indexOf( document.activeElement as HTMLButtonElement );
							const next =
								event.key === 'Home'
									? 0
									: event.key === 'End'
									? buttons.length - 1
									: ( index + ( event.key === 'ArrowDown' ? 1 : -1 ) + buttons.length ) %
									  buttons.length;
							if ( buttons[ next ] ) {
								event.preventDefault();
								buttons[ next ].focus();
							}
						} }
					>
						{ notes.map( ( note ) => (
							<div key={ note.id } className={ styles.row }>
								<Button
									data-annotation-edit
									variant="ghost"
									size="sm"
									className={ styles.note }
									disabled={ busy }
									aria-label={ sprintf(
										__( 'Edit annotation %d: %s' ),
										note.number,
										note.comment || __( 'Image annotation' )
									) }
									onClick={ () => {
										editing.current = true;
										setOpen( false );
										preview?.setOpen( true, { siteId } );
										requestAnnotationReview( siteId, note.id );
									} }
								>
									<span className={ styles.number } aria-hidden="true">
										{ note.number }
									</span>
									<span className={ styles.label }>
										{ note.comment || __( 'Image annotation' ) }
									</span>
								</Button>
								<IconButton
									variant="muted-ghost"
									icon={ <TrashIcon /> }
									size="icon-2xs"
									label={ sprintf( __( 'Delete annotation %d' ), note.number ) }
									disabled={ busy }
									onClick={ () => {
										const input = trigger.current
											?.closest( '[data-slot="input-group"]' )
											?.querySelector< HTMLTextAreaElement >( 'textarea' );
										removeAnnotations( siteId, [ note.id ] );
										requestAnimationFrame(
											() =>
												(
													list.current?.querySelector< HTMLButtonElement >(
														'[data-annotation-edit]'
													) ?? input
												)?.focus()
										);
									} }
								/>
							</div>
						) ) }
					</div>
				</Popover.Popup>
			</Popover.Root>
			<AttachmentRemoveButton
				className={ styles.remove }
				aria-label={ __( 'Remove attachment' ) }
				disabled={ busy }
				onClick={ onRemove }
			/>
		</AttachmentChip>
	);
}
