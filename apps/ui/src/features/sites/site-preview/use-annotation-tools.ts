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
	changeAnnotation,
	closeAnnotationEditor,
	getSiteAnnotations,
	hasAnnotationContent,
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
	const [ tool, setTool ] = useState< 'select' | 'draw' | 'text' >( 'select' );
	const drawing = tool === 'draw';
	const editingDrawing = annotations.notes.find( ( note ) => note.id === annotations.editingId )
		?.drawing;
	const [ draft, setDraft ] = useState< InspectorSelection | null >( null );
	const [ failed, setFailed ] = useState( false );
	const [ capturePending, setCapturePending ] = useState( false );
	const [ action, setAction ] = useState< InspectorAction | undefined >();
	const draftRef = useRef( draft );
	const generation = useRef( 0 );
	const capturing = useRef( false );
	const updateDraft = useCallback( ( next: InspectorSelection | null ) => {
		draftRef.current = next;
		setDraft( next );
		setFailed( false );
	}, [] );
	const command = useCallback( ( type: InspectorAction[ 'type' ], selectionId?: string ) => {
		setAction( ( current ) => ( { id: ( current?.id ?? 0 ) + 1, type, selectionId } ) );
	}, [] );
	const clear = useCallback(
		( selectionId?: string ) => {
			updateDraft( null );
			command( 'clear', selectionId );
		},
		[ command, updateDraft ]
	);
	useEffect( () => {
		const currentGeneration = ++generation.current;
		if ( ! enabled || ! annotations.active ) {
			if ( ! annotations.active ) setTool( 'select' );
			if ( draftRef.current ) clear();
		}
		return () => {
			generation.current = currentGeneration + 1;
		};
	}, [ enabled, annotations.active, siteId, clear ] );

	const capture = useCallback(
		async ( selection: InspectorSelection, turnOff = false ) => {
			if ( ! enabled || capturing.current ) return;
			const current = getSiteAnnotations( siteId );
			const replacement = selection.replaces
				? current.notes.find(
						( note ) =>
							note.id === selection.replaces &&
							note.id === current.editingId &&
							note.kind === 'drawing' &&
							note.url === selection.target.url &&
							note.drawing?.originalStroke
				  )
				: undefined;
			if ( selection.replaces && ! replacement ) {
				clear( selection.id );
				return;
			}
			if ( ! replacement && ! canPickAnnotation( siteId ) ) {
				setFailed( true );
				return;
			}
			const otherImages = [
				...current.notes
					.filter( ( note ) => note.id !== replacement?.id && hasAnnotationContent( note ) )
					.flatMap( ( note ) => note.images ),
				...( replacement?.images.slice( 1 ) ?? [] ),
			];
			if ( otherImages.length >= STUDIO_CHAT_MAX_IMAGES ) {
				setFailed( true );
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
			setCapturePending( true );
			setFailed( false );
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
				let id: string | null;
				if ( replacement ) {
					const latest = getSiteAnnotations( siteId );
					const note = latest.notes.find( ( note ) => note.id === replacement.id );
					if ( ! note || latest.editingId !== note.id ) return;
					changeAnnotation( siteId, note.id, {
						drawing: selection.drawing,
						documentRect: selection.target.documentRect,
						viewport: selection.target.viewport,
						images: [ { ...image, kind: 'image' }, ...note.images.slice( 1 ) ],
					} );
					id = note.id;
				} else
					id = onPick(
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
					clear( selection.id );
					if ( turnOff ) setTool( 'select' );
				}
			} catch {
				if ( generation.current !== attempt || draftRef.current?.id !== selection.id ) return;
				setFailed( true );
				toast.error( __( 'Could not capture the area. Your selection is kept. Try again.' ) );
			} finally {
				capturing.current = false;
				setCapturePending( false );
				setAnnotationsPreparing( siteId, false );
			}
		},
		[ clear, connector, enabled, onPick, siteId, viewportRef ]
	);
	useEffect( () => {
		if ( enabled && annotations.active && draft && ! capturePending && ! failed )
			void capture( draft );
	}, [ enabled, annotations.active, draft, capturePending, failed, capture ] );
	const handleEvent = useCallback(
		( event: Extract< InspectorEvent, { type: 'selection' | 'drawing' } > ) => {
			if ( ! enabled ) return;
			updateDraft( event.selection );
		},
		[ enabled, updateDraft ]
	);
	const toggleDrawing = () => {
		if ( capturing.current ) return;
		if ( draftRef.current ) {
			void capture( draftRef.current, drawing );
			return;
		}
		if ( ! canPickAnnotation( siteId ) ) return;
		closeAnnotationEditor( siteId );
		setTool( drawing ? 'select' : 'draw' );
	};
	const escapeDraft = () => {
		if ( ! draftRef.current ) return false;
		if ( ! capturing.current ) clear();
		return true;
	};
	return {
		drawing,
		tool,
		action,
		command,
		handleEvent,
		escapeDraft,
		controls: {
			drawing,
			editingText: tool === 'text',
			pending: !! draft,
			canUndo: !! draft?.drawing?.strokes.length || !! editingDrawing?.originalStroke,
			undoShape: ! draft && !! editingDrawing?.originalStroke,
			failed,
			onToggle: toggleDrawing,
			onToggleText: () => {
				if ( capturing.current || draftRef.current || ! canPickAnnotation( siteId ) ) return;
				closeAnnotationEditor( siteId );
				setTool( tool === 'text' ? 'select' : 'text' );
			},
			onUndo: () => command( 'undo' ),
			onRetry: () => {
				if ( draftRef.current ) void capture( draftRef.current );
			},
		},
	};
}
