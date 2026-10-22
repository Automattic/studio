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
import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from '@/data/app-messages';
import { useConnector } from '@/data/core';

export { toComposerSendAttachments };
export type { ComposerAttachment, ComposerSendAttachments };

// `disabled` blocks every entry point at once — button, drag-and-drop and
// paste all funnel through `addFiles`.
export function useComposerAttachments(
	initialAttachments: ComposerAttachment[] = [],
	disabled = false
) {
	const connector = useConnector();
	const [ attachments, setAttachments ] = useState< ComposerAttachment[] >( initialAttachments );
	const attachmentsRef = useRef< ComposerAttachment[] >( initialAttachments );

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

	const removeAttachments = useCallback( ( ids: ReadonlySet< string > ) => {
		setAttachments( ( current ) => {
			const next = current.filter( ( item ) => ! ids.has( item.id ) );
			attachmentsRef.current = next;
			return next;
		} );
	}, [] );

	const restore = useCallback(
		( items: ComposerAttachment[] ) => {
			setTrackedAttachments( items );
		},
		[ setTrackedAttachments ]
	);

	const addFiles = useCallback(
		async ( incoming: FileList | File[] ) => {
			const list = Array.from( incoming );
			if ( disabled || list.length === 0 ) {
				return;
			}
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
				toast.error( prepared.error );
			}
			if ( prepared.attachments.length === 0 ) {
				return;
			}

			const merged = mergeComposerAttachments(
				attachmentsRef.current,
				prepared.attachments,
				messages
			);
			if ( merged.error ) {
				toast.error( merged.error );
			}
			setTrackedAttachments( merged.attachments );
		},
		[ connector, disabled, setTrackedAttachments ]
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
		addFiles,
		removeAttachment,
		removeAttachments,
		restore,
		pasteHandlers: { onPaste },
	};
}

// Files dragged anywhere over `target`. The depth count keeps the state steady
// while the pointer crosses child elements.
export function useFileDrop( target: HTMLElement | null, onFiles: ( files: FileList ) => void ) {
	const [ isDragging, setIsDragging ] = useState( false );

	useEffect( () => {
		if ( ! target ) {
			return;
		}
		let depth = 0;
		const hasFiles = ( event: DragEvent ) =>
			Array.from( event.dataTransfer?.types ?? [] ).includes( 'Files' );
		const onDragEnter = ( event: DragEvent ) => {
			if ( hasFiles( event ) ) {
				depth += 1;
				setIsDragging( true );
			}
		};
		const onDragOver = ( event: DragEvent ) => {
			if ( hasFiles( event ) ) {
				event.preventDefault();
			}
		};
		const onDragLeave = ( event: DragEvent ) => {
			if ( hasFiles( event ) ) {
				depth = Math.max( 0, depth - 1 );
				setIsDragging( depth > 0 );
			}
		};
		const onDrop = ( event: DragEvent ) => {
			if ( ! hasFiles( event ) ) {
				return;
			}
			event.preventDefault();
			depth = 0;
			setIsDragging( false );
			if ( event.dataTransfer?.files.length ) {
				onFiles( event.dataTransfer.files );
			}
		};
		const listeners = {
			dragenter: onDragEnter,
			dragover: onDragOver,
			dragleave: onDragLeave,
			drop: onDrop,
		};
		for ( const [ type, listener ] of Object.entries( listeners ) ) {
			target.addEventListener( type, listener as EventListener );
		}
		return () => {
			for ( const [ type, listener ] of Object.entries( listeners ) ) {
				target.removeEventListener( type, listener as EventListener );
			}
		};
	}, [ target, onFiles ] );

	return isDragging;
}
