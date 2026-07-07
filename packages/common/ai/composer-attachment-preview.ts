import { toImageDataUrl } from './chat-images';
import type { ComposerAttachment } from './composer-attachments';

export const COMPOSER_ATTACHMENT_HOVER_PREVIEW_WIDTH = 285;
export const COMPOSER_ATTACHMENT_HOVER_PREVIEW_COMPACT_WIDTH = 220;
const COMPOSER_ATTACHMENT_HOVER_PREVIEW_MARGIN = 8;
const COMPOSER_ATTACHMENT_HOVER_TEXT_SCROLL_SPEED_PX_PER_SECOND = 12;
const COMPOSER_ATTACHMENT_HOVER_TEXT_SCROLL_HOLD_MS = 700;

export interface ComposerAttachmentHoverPreviewState {
	id: string;
	left: number;
	bottom: number;
	width: number;
}

export function formatComposerAttachmentSize( bytes: number ): string {
	if ( ! bytes ) {
		return '';
	}
	if ( bytes < 1024 ) {
		return `${ bytes } B`;
	}
	if ( bytes < 1024 * 1024 ) {
		return `${ Math.round( bytes / 1024 ) } KB`;
	}
	return `${ ( bytes / ( 1024 * 1024 ) ).toFixed( 1 ) } MB`;
}

export function getComposerAttachmentTypeLabel( name: string, fallbackLabel: string ): string {
	const extension = name.split( '.' ).pop();
	if ( extension && extension !== name ) {
		return extension.slice( 0, 4 ).toUpperCase();
	}
	return fallbackLabel;
}

export function getComposerAttachmentTypeDescription(
	attachment: ComposerAttachment,
	fallbackLabel: string
): string {
	const { mimeType } = attachment;
	if ( mimeType ) {
		return mimeType;
	}
	return getComposerAttachmentTypeLabel( attachment.name, fallbackLabel );
}

export function getComposerAttachmentImageSrc( attachment: ComposerAttachment ): string | null {
	if ( attachment.kind === 'image' ) {
		return toImageDataUrl( attachment.mimeType, attachment.dataBase64 );
	}
	if ( attachment.kind === 'clip' ) {
		return attachment.dataBase64 && attachment.mimeType
			? toImageDataUrl( attachment.mimeType, attachment.dataBase64 )
			: null;
	}
	return attachment.preview?.kind === 'image' ? attachment.preview.dataUrl : null;
}

export function getComposerAttachmentTextPreview( attachment: ComposerAttachment ): string | null {
	if ( attachment.kind === 'image' ) {
		return null;
	}
	if ( attachment.kind === 'clip' ) {
		return attachment.comment || null;
	}
	return attachment.preview?.kind === 'text' ? attachment.preview.text : null;
}

export function hasComposerAttachmentVisualPreview( attachment: ComposerAttachment ): boolean {
	if ( attachment.kind === 'image' ) {
		return true;
	}
	if ( attachment.kind === 'clip' ) {
		return !! attachment.dataBase64 || !! attachment.comment;
	}
	return attachment.preview?.kind === 'image' || attachment.preview?.kind === 'text';
}

export function getComposerAttachmentHoverPreviewPosition(
	element: HTMLElement,
	attachment: ComposerAttachment
): Omit< ComposerAttachmentHoverPreviewState, 'id' > {
	const width = hasComposerAttachmentVisualPreview( attachment )
		? COMPOSER_ATTACHMENT_HOVER_PREVIEW_WIDTH
		: COMPOSER_ATTACHMENT_HOVER_PREVIEW_COMPACT_WIDTH;
	const rect = element.getBoundingClientRect();
	const maxLeft = Math.max(
		COMPOSER_ATTACHMENT_HOVER_PREVIEW_MARGIN,
		window.innerWidth - width - COMPOSER_ATTACHMENT_HOVER_PREVIEW_MARGIN
	);
	return {
		left: Math.min( Math.max( rect.left, COMPOSER_ATTACHMENT_HOVER_PREVIEW_MARGIN ), maxLeft ),
		bottom: window.innerHeight - rect.top + COMPOSER_ATTACHMENT_HOVER_PREVIEW_MARGIN,
		width,
	};
}

export function watchComposerAttachmentTextScroll(
	viewportNode: HTMLElement | null,
	textNode: HTMLElement | null
): () => void {
	let scrollDistance: number | null = null;
	let scrollAnimation: Animation | null = null;

	const updateScrollAnimation = () => {
		if ( ! viewportNode || ! textNode ) {
			return;
		}

		const overflowDistance = Math.max(
			0,
			Math.ceil( textNode.scrollHeight - viewportNode.clientHeight )
		);
		if ( scrollDistance === overflowDistance ) {
			return;
		}

		scrollDistance = overflowDistance;
		scrollAnimation?.cancel();
		scrollAnimation = null;
		textNode.style.transform = '';

		if ( overflowDistance <= 1 || typeof textNode.animate !== 'function' ) {
			return;
		}

		const travelDurationMs =
			( overflowDistance / COMPOSER_ATTACHMENT_HOVER_TEXT_SCROLL_SPEED_PX_PER_SECOND ) * 1000;
		const totalDurationMs =
			COMPOSER_ATTACHMENT_HOVER_TEXT_SCROLL_HOLD_MS * 2 + travelDurationMs * 2;
		const topPauseOffset = COMPOSER_ATTACHMENT_HOVER_TEXT_SCROLL_HOLD_MS / totalDurationMs;
		const bottomOffset =
			( COMPOSER_ATTACHMENT_HOVER_TEXT_SCROLL_HOLD_MS + travelDurationMs ) / totalDurationMs;
		const bottomPauseOffset =
			( COMPOSER_ATTACHMENT_HOVER_TEXT_SCROLL_HOLD_MS * 2 + travelDurationMs ) / totalDurationMs;
		const bottomTransform = `translateY(-${ overflowDistance }px)`;

		scrollAnimation = textNode.animate(
			[
				{ transform: 'translateY(0)', offset: 0 },
				{ transform: 'translateY(0)', offset: topPauseOffset },
				{ transform: bottomTransform, offset: bottomOffset },
				{ transform: bottomTransform, offset: bottomPauseOffset },
				{ transform: 'translateY(0)', offset: 1 },
			],
			{
				duration: totalDurationMs,
				easing: 'linear',
				iterations: Infinity,
			}
		);
	};

	updateScrollAnimation();
	const animationFrame = window.requestAnimationFrame( updateScrollAnimation );
	const resizeObserver =
		typeof ResizeObserver === 'undefined' ? null : new ResizeObserver( updateScrollAnimation );
	if ( resizeObserver && viewportNode && textNode ) {
		resizeObserver.observe( viewportNode );
		resizeObserver.observe( textNode );
	}

	return () => {
		window.cancelAnimationFrame( animationFrame );
		scrollAnimation?.cancel();
		resizeObserver?.disconnect();
	};
}
