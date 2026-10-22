import { isStudioChatImageMimeType } from '@studio/common/ai/chat-images';
import { getComposerAttachmentImageSrc } from '@studio/common/ai/composer-attachment-preview';
import { __, _n, sprintf } from '@wordpress/i18n';
import { arrowUp, closeSmall, Icon } from '@wordpress/icons';
import { isAppleOS } from '@wordpress/keycodes';
import { Checkbox } from '@wordpress/ui';
import { clsx } from 'clsx';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
	useComposerAttachments,
	useFileDrop,
} from '@/components/session-view/composer/use-composer-attachments';
import { Button, IconButton } from '@/components/ui/button';
import {
	AlertDialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from '@/components/ui/dialog';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { toast } from '@/data/app-messages';
import { useSaveUserPreferences, useUserPreferences } from '@/data/queries/use-user-preferences';
import { paperclipIcon, trashIcon } from '@/lib/icons';
import { isImeComposing } from '@/lib/is-ime-composing';
import {
	changeAnnotation,
	clearAnnotations,
	closeAnnotationEditor,
	escapeAnnotations,
	hasAnnotationContent,
	isStagedAnnotation,
	removeAnnotations,
	stageAnnotations,
	useSiteAnnotations,
	type PreviewAnnotation,
} from './store';
import styles from './style.module.css';
import type { ComposerImageAttachment } from '@studio/common/ai/composer-attachments';

export interface AnnotationAnchor {
	left: number;
	top: number;
}

interface AnnotationOverlayProps {
	siteId: string;
	// Where the open note's editor hangs, in the overlay's coordinates.
	anchor: AnnotationAnchor | null;
	// Sends the notes (all of them with the chat draft, or just `noteIds`).
	onSend: ( noteIds?: string[] ) => void;
}

const EDGE = 8;
// Keeps the editor clear of the Send bar.
const BAR_CLEARANCE = 72;

/** The note editor and the Cancel / Send bar drawn over an annotated preview. */
export function AnnotationOverlay( { siteId, anchor, onSend }: AnnotationOverlayProps ) {
	const { active, notes, editingId } = useSiteAnnotations( siteId );
	const note = notes.find( ( item ) => item.id === editingId );
	const count = notes.filter( hasAnnotationContent ).length;
	const stagedCount = notes.filter( isStagedAnnotation ).length;
	const [ confirming, setConfirming ] = useState( false );
	const [ dontAsk, setDontAsk ] = useState( false );
	const cancelRef = useRef< HTMLButtonElement >( null );
	const { data: preferences } = useUserPreferences();
	const savePreferences = useSaveUserPreferences();

	useEffect( () => {
		if ( ! active ) return;
		const onKeyDown = ( event: KeyboardEvent ) => {
			if (
				event.key !== 'Escape' ||
				event.defaultPrevented ||
				( event.target instanceof Element && event.target.closest( '[role="alertdialog"]' ) )
			) {
				return;
			}
			event.preventDefault();
			escapeAnnotations( siteId );
		};
		document.addEventListener( 'keydown', onKeyDown );
		return () => document.removeEventListener( 'keydown', onKeyDown );
	}, [ active, siteId ] );

	const cancel = () => {
		if ( count && preferences?.confirmDeleteAnnotations !== false ) {
			setDontAsk( false );
			setConfirming( true );
		} else {
			clearAnnotations( siteId );
		}
	};

	return (
		<div className={ styles.overlay } data-annotation-overlay>
			{ active && note && anchor ? (
				<NoteEditor
					key={ note.id }
					siteId={ siteId }
					note={ note }
					anchor={ anchor }
					onSend={ onSend }
				/>
			) : null }
			<div
				role="toolbar"
				aria-label={ __( 'Annotations' ) }
				aria-hidden={ ! active }
				inert={ ! active }
				data-open={ active }
				className={ styles.bar }
			>
				<Button variant="ghost" onClick={ cancel }>
					{ __( 'Cancel' ) }
				</Button>
				<Button
					variant="accent"
					aria-label={ sprintf(
						/* translators: %d: number of annotations. */
						_n( 'Send %d annotation', 'Send %d annotations', count ),
						count
					) }
					disabled={ ! count }
					onClick={ () => onSend() }
				>
					{ __( 'Send' ) }
					{ stagedCount > 0 ? (
						<span className={ styles.count } aria-hidden="true">
							{ stagedCount }
						</span>
					) : null }
				</Button>
			</div>
			<AlertDialog open={ active && confirming } onOpenChange={ setConfirming }>
				<DialogContent layout="confirmation" initialFocus={ cancelRef }>
					<DialogHeader>
						<DialogTitle>
							{ count === 1
								? __( 'Delete annotation?' )
								: sprintf(
										/* translators: %d: number of annotations. */
										__( 'Delete %d annotations?' ),
										count
								  ) }
						</DialogTitle>
						<DialogDescription tone="default">
							{ _n(
								'This note and its attached images will be deleted.',
								'These notes and their attached images will be deleted.',
								count
							) }
						</DialogDescription>
					</DialogHeader>
					<label className={ styles.dialogCheckbox }>
						<Checkbox checked={ dontAsk } onCheckedChange={ setDontAsk } />
						{ __( 'Don’t ask again' ) }
					</label>
					<DialogFooter>
						<Button ref={ cancelRef } variant="outline" onClick={ () => setConfirming( false ) }>
							{ __( 'Cancel' ) }
						</Button>
						<Button
							variant="destructive"
							onClick={ () => {
								if ( dontAsk ) savePreferences.mutate( { confirmDeleteAnnotations: false } );
								setConfirming( false );
								clearAnnotations( siteId );
							} }
						>
							{ __( 'Delete annotations' ) }
						</Button>
					</DialogFooter>
				</DialogContent>
			</AlertDialog>
		</div>
	);
}

function NoteEditor( {
	siteId,
	note,
	anchor,
	onSend,
}: {
	siteId: string;
	note: PreviewAnnotation;
	anchor: AnnotationAnchor;
	onSend: ( noteIds?: string[] ) => void;
} ) {
	const editorRef = useRef< HTMLDivElement | null >( null );
	const [ editorNode, setEditorNode ] = useState< HTMLDivElement | null >( null );
	const fileInputRef = useRef< HTMLInputElement | null >( null );
	const [ position, setPosition ] = useState( { left: EDGE, top: EDGE } );
	const { attachments, addFiles, removeAttachment, pasteHandlers } = useComposerAttachments(
		note.images
	);
	const addImages = ( files: FileList | File[] ) => {
		const list = Array.from( files );
		if ( list.some( ( file ) => ! isStudioChatImageMimeType( file.type ) ) ) {
			toast.error( __( 'Only PNG, JPEG, GIF, and WebP images can be attached.' ) );
			return;
		}
		void addFiles( list );
	};
	const isDragging = useFileDrop( editorNode, addImages );

	useEffect( () => {
		changeAnnotation( siteId, note.id, { images: attachments as ComposerImageAttachment[] } );
	}, [ attachments, note.id, siteId ] );

	useLayoutEffect( () => {
		const editor = editorRef.current;
		const container = editor?.parentElement;
		if ( ! editor || ! container ) return;
		const measure = () => {
			const left = Math.max(
				EDGE,
				Math.min( anchor.left + EDGE, container.clientWidth - editor.offsetWidth - EDGE )
			);
			const top = Math.max(
				EDGE,
				Math.min( anchor.top + EDGE, container.clientHeight - editor.offsetHeight - BAR_CLEARANCE )
			);
			setPosition( ( old ) => ( old.left === left && old.top === top ? old : { left, top } ) );
		};
		measure();
		const observer = new ResizeObserver( measure );
		observer.observe( container );
		observer.observe( editor );
		return () => observer.disconnect();
	}, [ anchor ] );

	const hasContent = hasAnnotationContent( note );
	const submit = ( direct: boolean ) => {
		if ( ! hasContent ) return;
		if ( direct ) {
			onSend( [ note.id ] );
			closeAnnotationEditor( siteId );
		} else {
			stageAnnotations( siteId, [ note.id ] );
			closeAnnotationEditor( siteId );
		}
	};
	const submitLabel = isAppleOS()
		? __( 'Save annotation (Enter). Send directly (⌘Enter).' )
		: __( 'Save annotation (Enter). Send directly (Ctrl+Enter).' );

	return (
		<div
			ref={ ( node ) => {
				editorRef.current = node;
				setEditorNode( node );
			} }
			role="group"
			aria-label={ __( 'Annotation' ) }
			className={ clsx( styles.editor, isDragging && styles.editorDragging ) }
			style={ position }
		>
			{ attachments.length ? (
				<ul className={ styles.images } aria-label={ __( 'Attachments' ) }>
					{ attachments.map( ( attachment ) => (
						<li key={ attachment.id } className={ styles.image }>
							<img
								src={ getComposerAttachmentImageSrc( attachment ) ?? undefined }
								alt={ attachment.name }
							/>
							<button
								type="button"
								className={ styles.imageRemove }
								aria-label={ __( 'Remove attachment' ) }
								onClick={ () => removeAttachment( attachment.id ) }
							>
								<Icon icon={ closeSmall } size={ 16 } />
							</button>
						</li>
					) ) }
				</ul>
			) : null }
			<textarea
				autoFocus
				rows={ 1 }
				maxLength={ 10000 }
				className={ styles.input }
				aria-label={ __( 'Leave a note' ) }
				placeholder={ __( 'Leave a note…' ) }
				value={ note.comment }
				onChange={ ( event ) =>
					changeAnnotation( siteId, note.id, { comment: event.target.value } )
				}
				onPaste={ pasteHandlers.onPaste }
				onKeyDown={ ( event ) => {
					if ( isImeComposing( event ) || event.key !== 'Enter' || event.shiftKey ) return;
					event.preventDefault();
					submit( event.metaKey || event.ctrlKey );
				} }
			/>
			<div className={ styles.toolbar }>
				<IconButton
					size="icon-sm"
					shape="round"
					icon={ paperclipIcon }
					label={ __( 'Attach image' ) }
					onClick={ () => fileInputRef.current?.click() }
				/>
				<IconButton
					size="icon-sm"
					shape="round"
					icon={ trashIcon }
					label={ __( 'Delete annotation' ) }
					onClick={ () => removeAnnotations( siteId, [ note.id ] ) }
				/>
				<input
					ref={ fileInputRef }
					type="file"
					accept="image/png,image/jpeg,image/gif,image/webp"
					multiple
					hidden
					onChange={ ( event ) => {
						if ( event.target.files ) addImages( event.target.files );
						event.target.value = '';
					} }
				/>
				<Tooltip>
					<TooltipTrigger
						render={
							<Button
								variant={ hasContent ? 'accent' : 'default' }
								size="icon"
								shape="round"
								className={ styles.save }
								aria-label={ __( 'Save annotation' ) }
								disabled={ ! hasContent }
								onClick={ () => submit( false ) }
							/>
						}
					>
						<Icon icon={ arrowUp } />
					</TooltipTrigger>
					<TooltipContent>{ submitLabel }</TooltipContent>
				</Tooltip>
			</div>
		</div>
	);
}
