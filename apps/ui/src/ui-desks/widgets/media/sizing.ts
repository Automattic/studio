import type { MediaKind, MediaWidgetProps } from './types';
import type { RectangleWidgetShapeProps } from '@/ui-desks/widgets/geometry';

interface NaturalMediaDimensions {
	w: number;
	h: number;
}

export async function getFittedMediaShapeProps(
	widgetProps: MediaWidgetProps,
	shapeProps: RectangleWidgetShapeProps
) {
	if ( ! widgetProps.url ) {
		return null;
	}

	const dimensions = await readNaturalMediaDimensions( widgetProps.url, widgetProps.mediaKind );
	return getFittedMediaShapePropsFromDimensions( shapeProps, dimensions );
}

export function getFittedMediaShapePropsFromDimensions(
	shapeProps: RectangleWidgetShapeProps,
	dimensions: NaturalMediaDimensions | null
): RectangleWidgetShapeProps | null {
	if ( ! dimensions || dimensions.w <= 0 || dimensions.h <= 0 || shapeProps.w <= 0 ) {
		return null;
	}

	return {
		...shapeProps,
		h: Math.max( 1, Math.round( ( shapeProps.w * dimensions.h ) / dimensions.w ) ),
	};
}

function readNaturalMediaDimensions(
	url: string,
	kind: MediaKind
): Promise< NaturalMediaDimensions | null > {
	if ( kind === 'video' ) {
		return readNaturalVideoDimensions( url );
	}

	return readNaturalImageDimensions( url );
}

function readNaturalImageDimensions( url: string ): Promise< NaturalMediaDimensions | null > {
	if ( typeof Image === 'undefined' ) {
		return Promise.resolve( null );
	}

	return new Promise( ( resolve ) => {
		const image = new Image();
		image.onload = () => resolve( { w: image.naturalWidth, h: image.naturalHeight } );
		image.onerror = () => resolve( null );
		image.src = url;
	} );
}

function readNaturalVideoDimensions( url: string ): Promise< NaturalMediaDimensions | null > {
	if ( typeof document === 'undefined' ) {
		return Promise.resolve( null );
	}

	return new Promise( ( resolve ) => {
		const video = document.createElement( 'video' );
		video.preload = 'metadata';
		video.onloadedmetadata = () => resolve( { w: video.videoWidth, h: video.videoHeight } );
		video.onerror = () => resolve( null );
		video.src = url;
	} );
}
