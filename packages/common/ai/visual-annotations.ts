import { STUDIO_CHAT_MAX_IMAGES } from './chat-images';

export interface StudioVisualAnnotationSummary {
	comment: string;
	imageIds?: string[];
	tag?: string;
	elementLabel?: string;
	nearbyText?: string;
}

export const MAX_VISUAL_ANNOTATIONS = 100;
const MAX_COMMENT_LENGTH = 10_000;
const MAX_SERIALIZED_LENGTH = 1_000_000;
const ALLOWED_FIELDS = new Set( [ 'comment', 'tag', 'elementLabel', 'nearbyText', 'imageIds' ] );
const FIELD_LIMITS = {
	tag: 100,
	elementLabel: 500,
	nearbyText: 1_000,
} as const;

export function validateStudioVisualAnnotations(
	value: unknown,
	images: ReadonlyArray< { id: string } > = []
): StudioVisualAnnotationSummary[] | undefined {
	if ( value === undefined ) {
		return undefined;
	}
	if ( ! Array.isArray( value ) || value.length === 0 || value.length > MAX_VISUAL_ANNOTATIONS ) {
		throw new Error( 'Invalid visual annotations.' );
	}
	let serializedLength: number;
	try {
		serializedLength = JSON.stringify( value ).length;
	} catch {
		throw new Error( 'Invalid visual annotations.' );
	}
	if ( serializedLength > MAX_SERIALIZED_LENGTH ) {
		throw new Error( 'Visual annotations contain too much data.' );
	}
	return value.map( ( annotation ) => {
		if (
			typeof annotation !== 'object' ||
			annotation === null ||
			typeof ( annotation as StudioVisualAnnotationSummary ).comment !== 'string' ||
			( annotation as StudioVisualAnnotationSummary ).comment.length > MAX_COMMENT_LENGTH
		) {
			throw new Error( 'Invalid visual annotation.' );
		}
		if ( Object.keys( annotation ).some( ( field ) => ! ALLOWED_FIELDS.has( field ) ) ) {
			throw new Error( 'Invalid visual annotation.' );
		}
		const typed = annotation as StudioVisualAnnotationSummary;
		// Each id names one of the message's own images.
		if (
			typed.imageIds !== undefined &&
			( ! Array.isArray( typed.imageIds ) ||
				! typed.imageIds.length ||
				typed.imageIds.length > STUDIO_CHAT_MAX_IMAGES ||
				new Set( typed.imageIds ).size !== typed.imageIds.length ||
				typed.imageIds.some(
					( id ) => typeof id !== 'string' || ! images.some( ( image ) => image.id === id )
				) )
		) {
			throw new Error( 'Invalid annotation image references.' );
		}
		if ( ! typed.comment.trim() && ! typed.imageIds?.length ) {
			throw new Error( 'Invalid visual annotation.' );
		}
		for ( const field of [ 'tag', 'elementLabel', 'nearbyText' ] as const ) {
			if (
				typed[ field ] !== undefined &&
				( typeof typed[ field ] !== 'string' || typed[ field ].length > FIELD_LIMITS[ field ] )
			) {
				throw new Error( 'Invalid visual annotation.' );
			}
		}
		return {
			comment: typed.comment.trim(),
			...( typed.imageIds ? { imageIds: typed.imageIds.slice() } : {} ),
			tag: typed.tag?.trim() || undefined,
			elementLabel: typed.elementLabel?.trim() || undefined,
			nearbyText: typed.nearbyText?.trim() || undefined,
		};
	} );
}
