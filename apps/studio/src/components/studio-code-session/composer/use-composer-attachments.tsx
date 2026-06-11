import { STUDIO_CHAT_MAX_FILES, type StudioChatFileAttachment } from '@studio/common/ai/chat-files';
import {
	createStudioChatImagePreview,
	loadImageElement,
} from '@studio/common/ai/chat-image-preview';
import {
	STUDIO_CHAT_MAX_IMAGES,
	STUDIO_CHAT_MAX_IMAGE_BYTES,
	STUDIO_CHAT_MAX_TOTAL_IMAGE_BYTES,
	isStudioChatImageMimeType,
	toImageDataUrl,
	type StudioChatImage,
	type StudioChatImageMimeType,
} from '@studio/common/ai/chat-images';
import { __, sprintf } from '@wordpress/i18n';
import { useCallback, useState } from 'react';
import { getIpcApi } from 'src/lib/get-ipc-api';

// A pending attachment held in the composer before the message is sent. Images
// carry their base64 bytes (sent as multimodal content blocks); everything else
// is referenced by disk path (the agent reads it with its file tools).
export interface ComposerImageAttachment {
	id: string;
	kind: 'image';
	name: string;
	mimeType: StudioChatImageMimeType;
	size: number;
	width?: number;
	height?: number;
	// Downscaled thumbnail persisted on the transcript's user-prompt entry so
	// the full bytes aren't duplicated there.
	previewDataUrl?: string;
	dataBase64: string;
}

export interface ComposerFileAttachment {
	id: string;
	kind: 'file';
	name: string;
	path: string;
	mimeType?: string;
	size: number;
}

export type ComposerAttachment = ComposerImageAttachment | ComposerFileAttachment;

export interface ComposerSendAttachments {
	images: StudioChatImage[];
	files: StudioChatFileAttachment[];
}

export function toComposerSendAttachments(
	attachments: ComposerAttachment[]
): ComposerSendAttachments {
	const images: StudioChatImage[] = [];
	const files: StudioChatFileAttachment[] = [];
	for ( const attachment of attachments ) {
		if ( attachment.kind === 'image' ) {
			images.push( {
				id: attachment.id,
				name: attachment.name,
				mimeType: attachment.mimeType,
				size: attachment.size,
				width: attachment.width,
				height: attachment.height,
				previewDataUrl: attachment.previewDataUrl,
				dataBase64: attachment.dataBase64,
			} );
		} else {
			files.push( {
				id: attachment.id,
				name: attachment.name,
				path: attachment.path,
				mimeType: attachment.mimeType,
				size: attachment.size,
			} );
		}
	}
	return { images, files };
}

function newAttachmentId(): string {
	return `${ Date.now().toString( 36 ) }-${ Math.random().toString( 36 ).slice( 2, 10 ) }`;
}

function readFileAsBase64( file: File ): Promise< string > {
	return new Promise( ( resolve, reject ) => {
		const reader = new FileReader();
		reader.onerror = () => reject( reader.error ?? new Error( 'Failed to read file.' ) );
		reader.onload = () => {
			const result = typeof reader.result === 'string' ? reader.result : '';
			// `data:<mime>;base64,<payload>` — keep only the payload.
			const comma = result.indexOf( ',' );
			resolve( comma >= 0 ? result.slice( comma + 1 ) : result );
		};
		reader.readAsDataURL( file );
	} );
}

export function useComposerAttachments() {
	const [ attachments, setAttachments ] = useState< ComposerAttachment[] >( [] );
	const [ error, setError ] = useState< string | null >( null );
	const [ isDraggingOver, setIsDraggingOver ] = useState( false );

	const removeAttachment = useCallback( ( id: string ) => {
		setAttachments( ( current ) => current.filter( ( item ) => item.id !== id ) );
	}, [] );

	const clear = useCallback( () => {
		setAttachments( [] );
		setError( null );
	}, [] );

	// Put a batch back after a failed send so the user doesn't lose them.
	const restore = useCallback( ( items: ComposerAttachment[] ) => {
		setAttachments( items );
	}, [] );

	const addFiles = useCallback( async ( incoming: FileList | File[] ) => {
		const list = Array.from( incoming );
		if ( list.length === 0 ) {
			return;
		}
		setError( null );

		// Read images concurrently — FileReader I/O shouldn't serialize.
		const prepared = await Promise.all(
			list.map( async ( file ): Promise< ComposerAttachment | null > => {
				if ( isStudioChatImageMimeType( file.type ) ) {
					if ( file.size > STUDIO_CHAT_MAX_IMAGE_BYTES ) {
						setError( __( 'Images must be 5 MB or smaller.' ) );
						return null;
					}
					try {
						const dataBase64 = await readFileAsBase64( file );
						const imageElement = await loadImageElement( toImageDataUrl( file.type, dataBase64 ) );
						return {
							id: newAttachmentId(),
							kind: 'image',
							name: file.name,
							mimeType: file.type,
							size: file.size,
							width: imageElement?.naturalWidth,
							height: imageElement?.naturalHeight,
							previewDataUrl:
								imageElement && createStudioChatImagePreview( imageElement, file.type ),
							dataBase64,
						};
					} catch {
						setError( __( 'Failed to read the attached image.' ) );
						return null;
					}
				}

				// Non-image file: reference it by absolute path so the agent reads it.
				const path = getIpcApi().getPathForFile( file );
				if ( ! path ) {
					setError( __( 'This file could not be attached.' ) );
					return null;
				}
				return {
					id: newAttachmentId(),
					kind: 'file',
					name: file.name,
					path,
					mimeType: file.type || undefined,
					size: file.size,
				};
			} )
		);

		const next = prepared.filter( ( item ): item is ComposerAttachment => item !== null );
		if ( next.length === 0 ) {
			return;
		}

		setAttachments( ( current ) => {
			const merged = [ ...current ];
			const images = current.filter( ( item ) => item.kind === 'image' );
			let imageCount = images.length;
			let fileCount = current.length - imageCount;
			// Mirror the main-process total-bytes cap so an over-budget batch is
			// caught here, before it is cleared from the composer on send.
			let imageBytes = images.reduce( ( sum, item ) => sum + item.size, 0 );
			for ( const attachment of next ) {
				if ( attachment.kind === 'image' ) {
					if ( imageCount >= STUDIO_CHAT_MAX_IMAGES ) {
						setError(
							sprintf(
								/* translators: %d: maximum number of images. */
								__( 'You can attach up to %d images.' ),
								STUDIO_CHAT_MAX_IMAGES
							)
						);
						continue;
					}
					if ( imageBytes + attachment.size > STUDIO_CHAT_MAX_TOTAL_IMAGE_BYTES ) {
						setError( __( 'Attached images are too large to send together.' ) );
						continue;
					}
					imageCount++;
					imageBytes += attachment.size;
				} else {
					if ( fileCount >= STUDIO_CHAT_MAX_FILES ) {
						setError(
							sprintf(
								/* translators: %d: maximum number of files. */
								__( 'You can attach up to %d files.' ),
								STUDIO_CHAT_MAX_FILES
							)
						);
						continue;
					}
					fileCount++;
				}
				merged.push( attachment );
			}
			return merged;
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

	return {
		attachments,
		error,
		isDraggingOver,
		addFiles,
		removeAttachment,
		clear,
		restore,
		dragHandlers: { onDragOver, onDragLeave, onDrop },
	};
}
