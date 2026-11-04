import {
	STUDIO_CHAT_MAX_IMAGES,
	validateStudioChatImages,
} from '@studio/agent/protocol/chat-images';
import { __, sprintf } from '@wordpress/i18n';
import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import { toast } from '@/data/app-messages';
import { useConnector } from '@/data/core';
import {
	canPickAnnotation,
	closeAnnotationEditor,
	getSiteAnnotations,
	setAnnotationsPreparing,
	useSiteAnnotations,
} from '@/features/annotations';
import { getWebviewContentsId, type WebviewTag } from './preview-surface/webview';
import type { usePreviewAnnotations } from './use-preview-annotations';
import type { InspectorAction, InspectorEvent } from '@studio/agent/protocol/inspector/page-script';
import type { InspectorSelection } from '@studio/agent/protocol/inspector/selection';

export function useAnnotationTools( {
	siteId,
	enabled,
	viewportRef,
	onPick,
}: {
	siteId: string;
	enabled: boolean;
	viewportRef: RefObject< HTMLDivElement | null >;
	onPick: ReturnType< typeof usePreviewAnnotations >[ 'handleAnnotationPick' ];
} ) {
	const connector = useConnector();
	const annotations = useSiteAnnotations( siteId );
	const [ drawing, setDrawing ] = useState( false );
	const [ draft, setDraft ] = useState< InspectorSelection | null >( null );
	const [ failed, setFailed ] = useState( false );
	const [ action, setAction ] = useState< InspectorAction | undefined >();
	const draftRef = useRef( draft );
	const generation = useRef( 0 );
	const capturing = useRef( false );
	const updateDraft = useCallback( ( next: InspectorSelection | null ) => {
		draftRef.current = next;
		setDraft( next );
		setFailed( false );
	}, [] );
	const command = useCallback( ( type: InspectorAction[ 'type' ] ) => {
		setAction( ( current ) => ( { id: ( current?.id ?? 0 ) + 1, type } ) );
	}, [] );
	const clear = useCallback( () => {
		updateDraft( null );
		command( 'clear' );
	}, [ command, updateDraft ] );
	useEffect( () => {
		const currentGeneration = ++generation.current;
		if ( ! enabled || ! annotations.active ) {
			setDrawing( false );
			if ( draftRef.current ) clear();
		}
		return () => {
			generation.current = currentGeneration + 1;
		};
	}, [ enabled, annotations.active, siteId, clear ] );

	const capture = useCallback(
		async ( selection: InspectorSelection, turnOff = false ) => {
			if ( ! enabled || capturing.current || ! canPickAnnotation( siteId ) ) return;
			const otherImages = getSiteAnnotations( siteId ).notes.flatMap( ( note ) => note.images );
			if ( otherImages.length >= STUDIO_CHAT_MAX_IMAGES ) {
				toast.error(
					sprintf(
						__(
							'You can attach up to %d images. Send or delete an annotation before capturing another area.'
						),
						STUDIO_CHAT_MAX_IMAGES
					)
				);
				return;
			}
			const webview = viewportRef.current?.querySelector< WebviewTag >(
				'webview[data-annotation-surface]'
			);
			if ( ! webview ) return;
			const attempt = generation.current;
			capturing.current = true;
			setAnnotationsPreparing( siteId, true );
			try {
				const image = await connector.captureAnnotationRegion( {
					guestId: getWebviewContentsId( webview ),
					selection,
				} );
				if ( generation.current !== attempt || draftRef.current?.id !== selection.id ) return;
				validateStudioChatImages( [ ...otherImages, image ] );
				const box = webview.getBoundingClientRect();
				const scaleX = box.width / selection.target.viewport.width;
				const scaleY = box.height / selection.target.viewport.height;
				setAnnotationsPreparing( siteId, false );
				const id = onPick(
					selection.target,
					{
						left: box.left + ( selection.rect.left + selection.rect.width ) * scaleX,
						top: box.top + selection.rect.top * scaleY,
					},
					{
						images: [ { ...image, kind: 'image' } ],
						...( selection.drawing ? { drawing: selection.drawing } : {} ),
					}
				);
				if ( id ) {
					clear();
					if ( turnOff ) setDrawing( false );
				}
			} catch {
				if ( generation.current !== attempt || draftRef.current?.id !== selection.id ) return;
				setFailed( true );
				toast.error( __( 'Could not capture the area. Your selection is kept. Try again.' ) );
			} finally {
				capturing.current = false;
				setAnnotationsPreparing( siteId, false );
			}
		},
		[ clear, connector, enabled, onPick, siteId, viewportRef ]
	);
	const handleEvent = useCallback(
		( event: Extract< InspectorEvent, { type: 'selection' | 'drawing' } > ) => {
			if ( ! enabled ) return;
			updateDraft( event.selection );
			if ( event.type === 'selection' ) void capture( event.selection );
		},
		[ capture, enabled, updateDraft ]
	);
	const toggleDrawing = () => {
		if ( capturing.current ) return;
		if ( draftRef.current ) {
			void capture( draftRef.current, drawing );
			return;
		}
		if ( ! canPickAnnotation( siteId ) ) return;
		closeAnnotationEditor( siteId );
		setDrawing( ! drawing );
	};
	const escapeDraft = () => {
		if ( ! draftRef.current ) return false;
		if ( ! capturing.current ) clear();
		return true;
	};
	return {
		drawing,
		action,
		handleEvent,
		escapeDraft,
		controls: {
			drawing,
			pending: !! draft,
			canUndo: !! draft?.drawing?.strokes.length,
			failed,
			onToggle: toggleDrawing,
			onUndo: () => command( 'undo' ),
			onFinish: () => {
				if ( draftRef.current ) void capture( draftRef.current );
			},
		},
	};
}
