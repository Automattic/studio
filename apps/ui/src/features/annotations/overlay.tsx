import { isStudioChatImageMimeType } from '@studio/agent/protocol/chat-images';
import { getComposerAttachmentImageSrc } from '@studio/agent/protocol/composer-attachment-preview';
import { __ } from '@wordpress/i18n';
import { displayShortcut } from '@wordpress/keycodes';
import { PaperclipIcon } from 'lucide-react';
import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { toast } from '@/data/app-messages';
import { useSaveUserPreferences, useUserPreferences } from '@/data/queries/use-user-preferences';
import { useComposerAttachments, useFileDrop } from '@/data/use-composer-attachments';
import { SendIcon, TrashIcon } from '@/lib/icons';
import { isImeComposing, isShortcut } from '@/lib/keyboard';
import {
	AttachmentDropOverlay,
	AttachmentRemoveButton,
	Button,
	Checkbox,
	IconButton,
	Kbd,
	Textarea,
	Tooltip,
	TooltipContent,
	TooltipTrigger,
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
import type { ComposerImageAttachment } from '@studio/agent/protocol/composer-attachments';

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
const ANCHOR_OFFSET = 4;
const MARKER_CLEARANCE = 20;
/** The note editor drawn over an annotated preview. */
export function AnnotationOverlay( { siteId, anchor, onSend }: AnnotationOverlayProps ) {
	const annotations = useSiteAnnotations( siteId );
	const { active, notes, editingId } = annotations;
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
			escapeAnnotations( siteId );
		};
		document.addEventListener( 'keydown', onKeyDown );
		return () => document.removeEventListener( 'keydown', onKeyDown );
	}, [ active, siteId ] );

	return (
		<div className={ styles.overlay } data-annotation-overlay>
			{ active && note && anchor ? (
				<NoteEditor
					key={ note.id }
					siteId={ siteId }
					note={ note }
					anchor={ anchor }
					busy={ busy }
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
	onSend,
}: {
	siteId: string;
	note: PreviewAnnotation;
	anchor: AnnotationAnchor;
	busy: boolean;
	onSend: ( noteIds?: string[] ) => void;
} ) {
	const editorRef = useRef< HTMLDivElement | null >( null );
	const [ editorNode, setEditorNode ] = useState< HTMLDivElement | null >( null );
	const fileInputRef = useRef< HTMLInputElement | null >( null );
	const [ position, setPosition ] = useState< { left: number; top: number; maxHeight?: number } >( {
		left: EDGE,
		top: EDGE,
	} );
	const { attachments, addFiles, removeAttachment, pasteHandlers } = useComposerAttachments(
		note.images
	);
	const addImages = useCallback(
		( files: FileList | File[] ) => {
			const list = Array.from( files );
			if ( list.some( ( file ) => ! isStudioChatImageMimeType( file.type ) ) ) {
				toast.error( __( 'Only PNG, JPEG, GIF, and WebP images can be attached' ) );
				return;
			}
			const otherImages = getSiteAnnotations( siteId )
				.notes.filter( ( item ) => item.id !== note.id )
				.flatMap( ( item ) => item.images );
			setAnnotationsPreparing( siteId, true );
			void addFiles( list, otherImages ).finally( () => setAnnotationsPreparing( siteId, false ) );
		},
		[ addFiles, note.id, siteId ]
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
			const left = Math.max(
				EDGE,
				Math.min( anchor.left + ANCHOR_OFFSET, container.clientWidth - editor.offsetWidth - EDGE )
			);
			const height = Math.max( editor.offsetHeight, editor.scrollHeight );
			const below = Math.max( 0, container.clientHeight - EDGE - anchor.top - MARKER_CLEARANCE );
			const above = Math.max( 0, anchor.top - MARKER_CLEARANCE - EDGE );
			const placeBelow = height <= below || ( height > above && below >= above );
			const maxHeight = placeBelow ? below : above;
			const top = placeBelow
				? anchor.top + MARKER_CLEARANCE
				: anchor.top - MARKER_CLEARANCE - Math.min( height, maxHeight );
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
	const savePreferences = useSaveUserPreferences();
	const batchNotes = preferences?.batchAnnotations ?? false;
	const batchCheckboxId = useId();
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
			style={ position }
		>
			{ isDragging ? (
				<AttachmentDropOverlay>{ __( 'Drop to attach' ) }</AttachmentDropOverlay>
			) : null }
			{ attachments.length ? (
				<ul className={ styles.images } aria-label={ __( 'Attachments' ) }>
					{ attachments.map( ( attachment ) => (
						<li key={ attachment.id } className={ styles.image }>
							<img
								src={ getComposerAttachmentImageSrc( attachment ) ?? undefined }
								alt={ attachment.name }
							/>
							<AttachmentRemoveButton
								aria-label={ __( 'Remove attachment' ) }
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
				placeholder={ __( 'Describe the change…' ) }
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
			<div className={ styles.toolbar }>
				<IconButton
					size="icon"
					shape="round"
					icon={ <PaperclipIcon /> }
					label={ __( 'Attach image' ) }
					onClick={ () => fileInputRef.current?.click() }
				/>
				{ ( hasContent || note.staged ) && (
					<IconButton
						size="icon"
						shape="round"
						icon={ <TrashIcon /> }
						label={ __( 'Delete annotation' ) }
						disabled={ busy }
						onClick={ () => removeAnnotations( siteId, [ note.id ] ) }
					/>
				) }

				<label className={ styles.batchSetting } htmlFor={ batchCheckboxId }>
					<Checkbox
						className={ styles.batchCheckbox }
						id={ batchCheckboxId }
						checked={ batchNotes }
						aria-label={ __( 'Batch notes' ) }
						onCheckedChange={ ( batchAnnotations ) =>
							savePreferences.mutate(
								{ batchAnnotations },
								{
									onError: () =>
										toast.error( __( 'Could not update settings. Please try again.' ) ),
								}
							)
						}
					/>
					<span>{ __( 'Batch notes' ) }</span>
				</label>

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
							<span className={ styles.shortcutRow }>
								{ __( 'Send' ) }
								<Kbd>{ displayShortcut.primary( '↵' ) }</Kbd>
							</span>
						) }
					</TooltipContent>
				</Tooltip>
			</div>
		</div>
	);
}
