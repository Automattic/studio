import { isMediaKind, type MediaKind, type MediaWidgetProps } from './types';
import type { WidgetDropFeedbackTarget } from '@/ui-desks/widgets/types';
import type { CSSProperties } from 'react';

export const MEDIA_DROP_PREVIEW_KIND = 'media-preview';

export interface MediaDropPreviewPayload {
	url: string;
	alt: string;
	mediaKind: MediaKind;
}

interface MediaDropPreviewProps {
	media: MediaDropPreviewPayload;
	className: string;
	style?: CSSProperties;
}

export function MediaDropPreview( { media, className, style }: MediaDropPreviewProps ) {
	if ( media.mediaKind === 'video' ) {
		return (
			<video
				className={ className }
				src={ media.url }
				aria-label={ media.alt }
				muted
				loop
				autoPlay
				playsInline
				draggable={ false }
				style={ style }
			/>
		);
	}

	return (
		<img
			className={ className }
			src={ media.url }
			alt={ media.alt }
			draggable={ false }
			style={ style }
		/>
	);
}

export function createMediaDropPreviewTarget(
	mediaProps: MediaWidgetProps
): Omit< WidgetDropFeedbackTarget, 'phase' > {
	return {
		kind: MEDIA_DROP_PREVIEW_KIND,
		props: {
			url: mediaProps.url,
			alt: mediaProps.alt,
			mediaKind: mediaProps.mediaKind,
		},
	};
}

export function getMediaDropPreviewPayload(
	feedback: WidgetDropFeedbackTarget | null | undefined
): MediaDropPreviewPayload | null {
	if ( feedback?.kind !== MEDIA_DROP_PREVIEW_KIND ) {
		return null;
	}

	const props = feedback.props as Partial< MediaDropPreviewPayload >;
	if (
		typeof props.url !== 'string' ||
		typeof props.alt !== 'string' ||
		! isMediaKind( props.mediaKind )
	) {
		return null;
	}

	return {
		url: props.url,
		alt: props.alt,
		mediaKind: props.mediaKind,
	};
}
