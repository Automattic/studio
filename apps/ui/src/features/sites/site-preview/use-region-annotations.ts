import {
	STUDIO_CHAT_MAX_IMAGES,
	validateStudioChatImages,
} from '@studio/agent/protocol/chat-images';
import { INSPECTOR_COMMAND_EVENT } from '@studio/agent/protocol/inspector/page-script';
import { __, sprintf } from '@wordpress/i18n';
import { useCallback, useEffect, useRef, type RefObject } from 'react';
import { toast } from '@/data/app-messages';
import { useConnector } from '@/data/core';
import {
	canPickAnnotation,
	getSiteAnnotations,
	setAnnotationsPreparing,
	useSiteAnnotations,
} from '@/features/annotations';
import { getWebviewContentsId, type WebviewTag } from './preview-surface/webview';
import type { usePreviewAnnotations } from './use-preview-annotations';
import type { InspectorSelection } from '@studio/agent/protocol/inspector/selection';

export function useRegionAnnotations( {
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
	const { active } = useSiteAnnotations( siteId );
	const generation = useRef( 0 );
	const capturing = useRef( false );
	useEffect( () => {
		const current = ++generation.current;
		return () => {
			generation.current = current + 1;
		};
	}, [ enabled, active, siteId ] );

	return useCallback(
		async ( selection: InspectorSelection ) => {
			const webview = viewportRef.current?.querySelector< WebviewTag >(
				'webview[data-annotation-surface]'
			);
			if ( ! webview ) return;
			const attempt = generation.current;
			let startedCapture = false;
			try {
				if ( ! enabled || ! active || capturing.current || ! canPickAnnotation( siteId ) ) return;
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
				capturing.current = true;
				startedCapture = true;
				setAnnotationsPreparing( siteId, true );
				const image = await connector.captureAnnotationRegion( {
					guestId: getWebviewContentsId( webview ),
					selection,
				} );
				if ( generation.current !== attempt ) return;
				validateStudioChatImages( [ ...otherImages, image ] );
				const box = webview.getBoundingClientRect();
				const scaleX = box.width / selection.target.viewport.width;
				const scaleY = box.height / selection.target.viewport.height;
				setAnnotationsPreparing( siteId, false );
				onPick(
					selection.target,
					{
						left: box.left + ( selection.rect.left + selection.rect.width ) * scaleX,
						top: box.top + selection.rect.top * scaleY,
					},
					{ images: [ { ...image, kind: 'image' } ] }
				);
			} catch {
				if ( generation.current === attempt ) {
					toast.error( __( 'Could not capture the area. Drag to select it again.' ) );
				}
			} finally {
				if ( startedCapture ) {
					capturing.current = false;
					setAnnotationsPreparing( siteId, false );
				}
				void Promise.resolve()
					.then( () =>
						webview.executeJavaScript(
							`window.dispatchEvent(new CustomEvent(${ JSON.stringify(
								INSPECTOR_COMMAND_EVENT
							) }, { detail: { clearSelection: ${ JSON.stringify( selection.id ) } } }));`,
							false
						)
					)
					.catch( () => undefined );
			}
		},
		[ active, connector, enabled, onPick, siteId, viewportRef ]
	);
}
