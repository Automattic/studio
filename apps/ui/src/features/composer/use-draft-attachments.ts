import { watchComposerFilePaste } from '@studio/agent/protocol/composer-attachments';
import { useCallback, useEffect, useMemo, type ChangeEvent, type RefObject } from 'react';
import {
	useComposerAttachments,
	useFileDrop,
	type ComposerAttachment,
} from '@/data/use-composer-attachments';
import {
	getAnnotationsAttachment,
	isStagedAnnotation,
	removeAnnotations,
	useSiteAnnotations,
} from '@/features/annotations';

// File/image attachments (attach button, drop and paste). Images ride as
// base64 content blocks; other files are referenced by disk path. The site's
// staged annotations show first, as one file.
export function useDraftAttachments( {
	initialAttachments,
	annotationSiteId,
	dropTarget,
	textareaRef,
}: {
	initialAttachments: ComposerAttachment[];
	annotationSiteId?: string;
	dropTarget: HTMLElement | null;
	textareaRef: RefObject< HTMLTextAreaElement | null >;
} ) {
	const {
		attachments,
		addFiles,
		removeAttachment,
		restore: restoreAttachments,
		pasteHandlers,
	} = useComposerAttachments( initialAttachments );
	const { notes } = useSiteAnnotations( annotationSiteId );
	const stagedNotes = useMemo( () => notes.filter( isStagedAnnotation ), [ notes ] );
	const annotationsAttachment = stagedNotes.length ? getAnnotationsAttachment( stagedNotes ) : null;
	const shownAttachments = annotationsAttachment
		? [ annotationsAttachment, ...attachments ]
		: attachments;
	const dropFiles = useCallback(
		( files: FileList ) => {
			void addFiles( files );
			textareaRef.current?.focus();
		},
		[ addFiles, textareaRef ]
	);
	const isDraggingFiles = useFileDrop( dropTarget, dropFiles );

	useEffect( () => {
		return watchComposerFilePaste( ( files ) => {
			void addFiles( files );
			textareaRef.current?.focus();
		} );
	}, [ addFiles, textareaRef ] );

	const onFileInputChange = useCallback(
		( event: ChangeEvent< HTMLInputElement > ) => {
			if ( event.target.files && event.target.files.length > 0 ) {
				void addFiles( event.target.files );
			}
			// Reset so picking the same file again re-triggers change.
			event.target.value = '';
		},
		[ addFiles ]
	);

	const removeShownAttachment = ( attachment: ComposerAttachment ) =>
		attachment === annotationsAttachment && annotationSiteId
			? removeAnnotations(
					annotationSiteId,
					stagedNotes.map( ( note ) => note.id )
			  )
			: removeAttachment( attachment.id );

	return {
		attachments,
		restoreAttachments,
		pasteHandlers,
		stagedNotes,
		annotationsAttachment,
		shownAttachments,
		removeShownAttachment,
		isDraggingFiles,
		onFileInputChange,
	};
}
