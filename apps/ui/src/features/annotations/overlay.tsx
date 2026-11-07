import { isStudioChatImageMimeType } from '@studio/agent/protocol/chat-images';
import { getComposerAttachmentImageSrc } from '@studio/agent/protocol/composer-attachment-preview';
import { __ } from '@wordpress/i18n';
import { displayShortcut } from '@wordpress/keycodes';
import { PaperclipIcon } from 'lucide-react';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useUserPreferences } from '@/data/queries/use-user-preferences';
import { useComposerAttachments, useFileDrop } from '@/data/use-composer-attachments';
import { SendIcon, TrashIcon } from '@/lib/icons';
import { isImeComposing, isShortcut } from '@/lib/keyboard';
import {
	DropOverlay,
	FieldError,
	AttachmentRemoveButton,
	Button,
	IconButton,
	Kbd,
	Textarea,
	Tooltip,
	TooltipContent,
	TooltipTrigger,
	VisuallyHidden,
} from '@/lib/ui';
import {
	changeAnnotation,
	closeAnnotationEditor,
	escapeAnnotations,
	getSiteAnnotations,
	hasAnnotationContent,
	isAnnotationsBusy,
	setAnnotationsPreparing,
	removeAnnotations,
	stageAnnotations,
	useSiteAnnotations,
	type PreviewAnnotation,
} from './store';
import styles from './style.module.css';
import { ANNOTATION_SHAKE_MS, useAnnotationFeedback } from './use-annotation-feedback';
import type { ComposerImageAttachment } from '@studio/agent/protocol/composer-attachments';
import type { CSSProperties } from 'react';

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
	onEscape?: () => boolean;
}

const EDGE = 8;
const CORNER_OFFSET = 8;
/** The note editor drawn over an annotated preview. */
export function AnnotationOverlay( { siteId, anchor, onSend, onEscape }: AnnotationOverlayProps ) {
	const annotations = useSiteAnnotations( siteId );
	const { active, notes, editingId, blockedNavigation } = annotations;
	const busy = isAnnotationsBusy( annotations );
	const note = notes.find( ( item ) => item.id === editingId );

	useEffect( () => {
		if ( ! active ) return;
		const onKeyDown = ( event: KeyboardEvent ) => {
			if (
				event.key !== 'Escape' ||
				event.defaultPrevented ||
				document.querySelector( '[data-slot="dialog-content"]:not([data-closed])' )
			) {
				return;
			}
			event.preventDefault();
			if ( ! onEscape?.() ) escapeAnnotations( siteId );
		};
		document.addEventListener( 'keydown', onKeyDown );
		return () => document.removeEventListener( 'keydown', onKeyDown );
	}, [ active, siteId, onEscape ] );

	return (
		<div className={ styles.overlay } data-annotation-overlay>
			{ active && note && anchor ? (
				<NoteEditor
					key={ note.id }
					siteId={ siteId }
					note={ note }
					anchor={ anchor }
					busy={ busy }
					blockedNavigation={ blockedNavigation }
					onSend={ onSend }
				/>
			) : null }
		</div>
	);
}

function NoteEditor( {
	siteId,
	note,
	anchor,
	busy,
	blockedNavigation,
	onSend,
}: {
	siteId: string;
	note: PreviewAnnotation;
	anchor: AnnotationAnchor;
	busy: boolean;
	blockedNavigation?: number;
	onSend: ( noteIds?: string[] ) => void;
} ) {
	const editorRef = useRef< HTMLDivElement | null >( null );
	const [ editorNode, setEditorNode ] = useState< HTMLDivElement | null >( null );
	const fileInputRef = useRef< HTMLInputElement | null >( null );
	const feedback = useAnnotationFeedback( blockedNavigation, true );
	useEffect( () => {
		if ( feedback === 'shake' ) editorRef.current?.querySelector( 'textarea' )?.focus();
	}, [ feedback, blockedNavigation ] );
	const [ position, setPosition ] = useState< { left: number; top: number; maxHeight?: number } >( {
		left: EDGE,
		top: EDGE,
	} );
	const {
		attachments,
		addFiles,
		removeAttachment,
		pasteHandlers,
		error: attachmentError,
		setError: setAttachmentError,
	} = useComposerAttachments( note.images );
	// Drawing annotations keep their captured page image first.
	const visibleAttachments = note.kind ? attachments.slice( 1 ) : attachments;
	const addImages = useCallback(
		( files: FileList | File[] ) => {
			const list = Array.from( files );
			if ( list.some( ( file ) => ! isStudioChatImageMimeType( file.type ) ) ) {
				setAttachmentError( __( 'Only PNG, JPEG, GIF, and WebP images can be attached' ) );
				return;
			}
			const otherImages = getSiteAnnotations( siteId )
				.notes.filter( ( item ) => item.id !== note.id )
				.flatMap( ( item ) => item.images );
			setAnnotationsPreparing( siteId, true );
			void addFiles( list, otherImages ).finally( () => setAnnotationsPreparing( siteId, false ) );
		},
		[ addFiles, note.id, siteId, setAttachmentError ]
	);
	const isDragging = useFileDrop( editorNode, addImages );

	useEffect( () => {
		changeAnnotation( siteId, note.id, { images: attachments as ComposerImageAttachment[] } );
	}, [ attachments, note.id, siteId ] );

	useLayoutEffect( () => {
		const editor = editorRef.current;
		const container = editor?.parentElement;
		if ( ! editor || ! container ) return;
		const measure = () => {
			const desiredLeft =
				anchor.left + CORNER_OFFSET + editor.offsetWidth <= container.clientWidth - EDGE
					? anchor.left + CORNER_OFFSET
					: anchor.left - CORNER_OFFSET - editor.offsetWidth;
			const left = Math.max(
				EDGE,
				Math.min( desiredLeft, container.clientWidth - editor.offsetWidth - EDGE )
			);
			const markerOffset = left === desiredLeft ? CORNER_OFFSET : 22;
			const height = Math.max( editor.offsetHeight, editor.scrollHeight );
			const below = Math.max( 0, container.clientHeight - EDGE - anchor.top - markerOffset );
			const above = Math.max( 0, anchor.top - markerOffset - EDGE );
			const placeBelow = height <= below || ( height > above && below >= above );
			const maxHeight = placeBelow ? below : above;
			const top = placeBelow
				? anchor.top + markerOffset
				: anchor.top - markerOffset - Math.min( height, maxHeight );
			setPosition( ( old ) =>
				old.left === left && old.top === top && old.maxHeight === maxHeight
					? old
					: { left, top, maxHeight }
			);
		};
		measure();
		const observer = new ResizeObserver( measure );
		observer.observe( container );
		observer.observe( editor );
		return () => observer.disconnect();
	}, [ anchor ] );

	const hasContent = hasAnnotationContent( note );
	const { data: preferences } = useUserPreferences();
	const batchNotes = preferences?.batchAnnotations ?? true;
	const submit = ( sendImmediately = false ) => {
		if ( ! hasContent || busy ) return;
		if ( batchNotes && ! sendImmediately ) stageAnnotations( siteId, [ note.id ], true );
		else onSend( [ note.id ] );
		closeAnnotationEditor( siteId );
	};

	return (
		<div
			ref={ ( node ) => {
				editorRef.current = node;
				setEditorNode( node );
			} }
			role="group"
			aria-label={ __( 'Annotation' ) }
			className={ styles.editor }
			data-feedback={ feedback ?? undefined }
			style={
				{ ...position, '--error-shake-duration': `${ ANNOTATION_SHAKE_MS }ms` } as CSSProperties
			}
		>
			{ feedback && (
				<VisuallyHidden role="alert">
					{ __( 'Add or delete this annotation before starting another.' ) }
				</VisuallyHidden>
			) }
			{ isDragging ? <DropOverlay>{ __( 'Drop to attach' ) }</DropOverlay> : null }
			{ visibleAttachments.length ? (
				<ul className={ styles.images } aria-label={ __( 'Attachments' ) }>
					{ visibleAttachments.map( ( attachment ) => (
						<li key={ attachment.id } className={ styles.image }>
							<img
								src={ getComposerAttachmentImageSrc( attachment ) ?? undefined }
								alt={ attachment.name }
							/>
							<AttachmentRemoveButton
								label={ __( 'Remove attachment' ) }
								onClick={ () => removeAttachment( attachment.id ) }
							/>
						</li>
					) ) }
				</ul>
			) : null }
			<Textarea
				autoFocus
				rows={ 1 }
				maxLength={ 10000 }
				variant="group"
				size="sm"
				aria-label={ __( 'Describe the change' ) }
				placeholder={ __( 'Describe the change' ) }
				value={ note.comment }
				onChange={ ( event ) =>
					changeAnnotation( siteId, note.id, { comment: event.target.value } )
				}
				onPaste={ pasteHandlers.onPaste }
				onKeyDown={ ( event ) => {
					if ( isImeComposing( event ) || event.key !== 'Enter' || event.shiftKey ) return;
					event.preventDefault();
					submit( isShortcut( event.nativeEvent, 'Enter' ) );
				} }
			/>
			{ attachmentError ? <FieldError role="alert">{ attachmentError }</FieldError> : null }
			<div className={ styles.toolbar }>
				<IconButton
					size="icon"
					shape="round"
					icon={ <PaperclipIcon /> }
					label={ __( 'Attach image' ) }
					onClick={ () => fileInputRef.current?.click() }
				/>
				<IconButton
					size="icon"
					shape="round"
					destructive
					icon={ <TrashIcon /> }
					label={ __( 'Delete annotation' ) }
					disabled={ busy }
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
								variant="accent"
								size="icon"
								shape="round"
								className={ styles.save }
								aria-label={
									batchNotes ? __( 'Add annotation to batch' ) : __( 'Send annotation' )
								}
								disabled={ ! hasContent || busy }
								onClick={ () => submit() }
							/>
						}
					>
						<SendIcon />
					</TooltipTrigger>
					<TooltipContent className={ styles.submitTooltip }>
						<span className={ styles.shortcutRow }>
							{ batchNotes ? __( 'Add' ) : __( 'Send' ) }
							<Kbd>{ '↵' }</Kbd>
						</span>
						{ batchNotes && (
							<>
								<span className={ styles.submitSeparator } aria-hidden="true" />
								<span className={ styles.shortcutRow }>
									{ __( 'Send' ) }
									<Kbd>{ displayShortcut.primary( '↵' ) }</Kbd>
								</span>
							</>
						) }
					</TooltipContent>
				</Tooltip>
			</div>
		</div>
	);
}
