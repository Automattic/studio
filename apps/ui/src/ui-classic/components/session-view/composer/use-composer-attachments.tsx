import { STUDIO_CHAT_MAX_FILES } from '@studio/common/ai/chat-files';
import { STUDIO_CHAT_MAX_IMAGES } from '@studio/common/ai/chat-images';
import {
	getComposerClipboardFiles,
	mergeComposerAttachments,
	prepareComposerAttachments,
	toComposerSendAttachments,
	type ComposerAttachment,
	type ComposerSendAttachments,
} from '@studio/common/ai/composer-attachments';
import { __, sprintf } from '@wordpress/i18n';
import { useCallback, useRef, useState } from 'react';
import { useConnector } from '@/data/core';

export { toComposerSendAttachments };
export type { ComposerAttachment, ComposerSendAttachments };

export function useComposerAttachments( initialAttachments: ComposerAttachment[] = [] ) {
	const connector = useConnector();
	const [ attachments, setAttachments ] = useState< ComposerAttachment[] >( initialAttachments );
	const attachmentsRef = useRef< ComposerAttachment[] >( initialAttachments );
	const [ error, setError ] = useState< string | null >( null );
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
		setError( null );
	}, [ setTrackedAttachments ] );

	// Put a batch back after a failed send so the user doesn't lose them.
	const restore = useCallback(
		( items: ComposerAttachment[] ) => {
			setTrackedAttachments( items );
		},
		[ setTrackedAttachments ]
	);

	const addFiles = useCallback(
		async ( incoming: FileList | File[] ) => {
			const list = Array.from( incoming );
			if ( list.length === 0 ) {
				return;
			}
			setError( null );
			const messages = {
				imageTooLarge: __( 'Images must be 5 MB or smaller.' ),
				imageReadFailed: __( 'Failed to read the attached image.' ),
				fileAttachFailed: __( 'This file could not be attached.' ),
				maxImages: sprintf(
					/* translators: %d: maximum number of images. */
					__( 'You can attach up to %d images.' ),
					STUDIO_CHAT_MAX_IMAGES
				),
				totalImagesTooLarge: __( 'Attached images are too large to send together.' ),
				maxFiles: sprintf(
					/* translators: %d: maximum number of files. */
					__( 'You can attach up to %d files.' ),
					STUDIO_CHAT_MAX_FILES
				),
			};

			const prepared = await prepareComposerAttachments( list, {
				resolveFilePath: ( file ) => connector.getFilePath( file ),
				messages,
				existingAttachments: attachmentsRef.current,
			} );
			if ( prepared.error ) {
				setError( prepared.error );
			}
			if ( prepared.attachments.length === 0 ) {
				return;
			}

			setAttachments( ( current ) => {
				const merged = mergeComposerAttachments( current, prepared.attachments, messages );
				if ( merged.error ) {
					setError( merged.error );
				}
				attachmentsRef.current = merged.attachments;
				return merged.attachments;
			} );
		},
		[ connector ]
	);

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
		error,
		isDraggingOver,
		addFiles,
		removeAttachment,
		clear,
		restore,
		dragHandlers: { onDragOver, onDragLeave, onDrop },
		pasteHandlers: { onPaste },
	};
}
