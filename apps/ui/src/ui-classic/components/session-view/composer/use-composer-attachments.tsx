import { STUDIO_CHAT_MAX_FILES, type StudioChatFileAttachment } from '@studio/common/ai/chat-files';
import {
	getStudioChatImageLimits,
	type StudioChatImageLimits,
} from '@studio/common/ai/chat-images';
import {
	getComposerClipboardFiles,
	mergeComposerAttachments,
	prepareComposerAttachments,
	prepareComposerClipAttachment,
	toComposerSendAttachments,
	type ComposerAttachment,
	type ComposerClipInput,
	type ComposerFilePreview,
	type ComposerSendAttachments,
} from '@studio/common/ai/composer-attachments';
import { __, sprintf } from '@wordpress/i18n';
import { useCallback, useMemo, useRef, useState } from 'react';
import { toast } from '@/data/app-messages';
import { useConnector } from '@/data/core';
import type { AiModelFamily } from '@studio/common/ai/models';

export { toComposerSendAttachments };
export type { ComposerAttachment, ComposerClipInput, ComposerSendAttachments };

type ComposerFileAttachmentInput = StudioChatFileAttachment & {
	preview?: ComposerFilePreview;
};

function getComposerAttachmentMessages( limits: StudioChatImageLimits ) {
	return {
		imageTooLarge: __( 'This image is too large to attach.' ),
		imageReadFailed: __( 'Failed to read the attached image.' ),
		fileAttachFailed: __( 'This file could not be attached.' ),
		maxImages: sprintf(
			/* translators: %d: maximum number of images. */
			__( 'You can attach up to %d images.' ),
			limits.maxImages
		),
		totalImagesTooLarge: __( 'Attached images are too large to send together.' ),
		maxFiles: sprintf(
			/* translators: %d: maximum number of files. */
			__( 'You can attach up to %d files.' ),
			STUDIO_CHAT_MAX_FILES
		),
	};
}

export function useComposerAttachments( modelFamily?: AiModelFamily ) {
	const connector = useConnector();
	const limits = useMemo( () => getStudioChatImageLimits( modelFamily ), [ modelFamily ] );
	const [ attachments, setAttachments ] = useState< ComposerAttachment[] >( [] );
	const attachmentsRef = useRef< ComposerAttachment[] >( [] );
	const [ isDraggingOver, setIsDraggingOver ] = useState( false );

	const setTrackedAttachments = useCallback( ( next: ComposerAttachment[] ) => {
		attachmentsRef.current = next;
		setAttachments( next );
	}, [] );

	const removeAttachment = useCallback( ( id: string ) => {
		setAttachments( ( current ) => {
			const next = current.filter( ( item ) => item.id !== id );
			attachmentsRef.current = next;
			return next;
		} );
	}, [] );

	const clear = useCallback( () => {
		setTrackedAttachments( [] );
	}, [ setTrackedAttachments ] );

	// Put a batch back after a failed send so the user doesn't lose them.
	const restore = useCallback(
		( items: ComposerAttachment[] ) => {
			setTrackedAttachments( items );
		},
		[ setTrackedAttachments ]
	);

	const addFiles = useCallback(
		async ( incoming: FileList | File[] ): Promise< boolean > => {
			const list = Array.from( incoming );
			if ( list.length === 0 ) {
				return false;
			}
			const messages = getComposerAttachmentMessages( limits );

			const prepared = await prepareComposerAttachments( list, {
				resolveFilePath: ( file ) => connector.getFilePath( file ),
				messages,
				existingAttachments: attachmentsRef.current,
				limits,
			} );
			if ( prepared.error ) {
				toast.error( prepared.error );
			}
			if ( prepared.attachments.length === 0 ) {
				return false;
			}

			// Merge against the ref (kept in lockstep with state) rather than
			// inside the state updater, so the failure toast fires from this
			// event handler and not from a render-phase updater.
			const merged = mergeComposerAttachments(
				attachmentsRef.current,
				prepared.attachments,
				messages,
				limits
			);
			if ( merged.error ) {
				toast.error( merged.error );
			}
			setTrackedAttachments( merged.attachments );
			return true;
		},
		[ connector, setTrackedAttachments, limits ]
	);

	const addFileAttachments = useCallback(
		( incoming: ComposerFileAttachmentInput[] ): boolean => {
			if ( incoming.length === 0 ) {
				return false;
			}
			const messages = getComposerAttachmentMessages( limits );
			const prepared: ComposerAttachment[] = incoming.map( ( file ) => ( {
				id: file.id,
				kind: 'file',
				name: file.name,
				path: file.path,
				mimeType: file.mimeType,
				size: file.size ?? 0,
				preview: file.preview,
			} ) );

			const merged = mergeComposerAttachments( attachmentsRef.current, prepared, messages, limits );
			if ( merged.error ) {
				toast.error( merged.error );
			}
			const didAdd = merged.attachments.length > attachmentsRef.current.length;
			setTrackedAttachments( merged.attachments );
			return didAdd;
		},
		[ setTrackedAttachments, limits ]
	);

	// Clips from the site preview. Same quota rules as images (their capture
	// rides as an image content block); errors surface as toasts like the
	// file paths above.
	const addClip = useCallback(
		async ( input: ComposerClipInput ): Promise< boolean > => {
			const messages = getComposerAttachmentMessages( limits );
			const prepared = await prepareComposerClipAttachment( input, messages, limits );
			if ( prepared.error || ! prepared.attachment ) {
				toast.error( prepared.error ?? messages.fileAttachFailed );
				return false;
			}
			const merged = mergeComposerAttachments(
				attachmentsRef.current,
				[ prepared.attachment ],
				messages,
				limits
			);
			if ( merged.error ) {
				toast.error( merged.error );
			}
			const didAdd = merged.attachments.length > attachmentsRef.current.length;
			setTrackedAttachments( merged.attachments );
			return didAdd;
		},
		[ setTrackedAttachments, limits ]
	);

	const updateClipComment = useCallback( ( id: string, comment: string ) => {
		setAttachments( ( current ) => {
			const next = current.map( ( item ) =>
				item.id === id && item.kind === 'clip'
					? { ...item, comment: comment.trim() || undefined }
					: item
			);
			attachmentsRef.current = next;
			return next;
		} );
	}, [] );

	const onDragOver = useCallback( ( event: React.DragEvent ) => {
		if ( ! Array.from( event.dataTransfer.types ).includes( 'Files' ) ) {
			return;
		}
		event.preventDefault();
		setIsDraggingOver( true );
	}, [] );

	const onDragLeave = useCallback( ( event: React.DragEvent ) => {
		event.preventDefault();
		setIsDraggingOver( false );
	}, [] );

	const onDrop = useCallback(
		( event: React.DragEvent ) => {
			if ( ! Array.from( event.dataTransfer.types ).includes( 'Files' ) ) {
				return;
			}
			event.preventDefault();
			setIsDraggingOver( false );
			if ( event.dataTransfer.files.length > 0 ) {
				void addFiles( event.dataTransfer.files );
			}
		},
		[ addFiles ]
	);

	const onPaste = useCallback(
		( event: React.ClipboardEvent ) => {
			const files = getComposerClipboardFiles( event.clipboardData );
			if ( files.length === 0 ) {
				return;
			}
			event.preventDefault();
			void addFiles( files );
		},
		[ addFiles ]
	);

	return {
		attachments,
		isDraggingOver,
		addFiles,
		addFileAttachments,
		addClip,
		updateClipComment,
		removeAttachment,
		clear,
		restore,
		dragHandlers: { onDragOver, onDragLeave, onDrop },
		pasteHandlers: { onPaste },
	};
}
