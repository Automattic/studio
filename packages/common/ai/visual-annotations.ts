export interface StudioVisualAnnotationSummary {
	comment: string;
	tag?: string;
	elementLabel?: string;
	nearbyText?: string;
}

const MAX_VISUAL_ANNOTATIONS = 100;
const MAX_COMMENT_LENGTH = 10_000;
const FIELD_LIMITS = {
	tag: 100,
	elementLabel: 500,
	nearbyText: 1_000,
} as const;

export function validateStudioVisualAnnotations(
	value: unknown
): StudioVisualAnnotationSummary[] | undefined {
	if ( value === undefined ) {
		return undefined;
	}
	if ( ! Array.isArray( value ) || value.length === 0 || value.length > MAX_VISUAL_ANNOTATIONS ) {
		throw new Error( 'Invalid visual annotations.' );
	}
	return value.map( ( annotation ) => {
		if (
			typeof annotation !== 'object' ||
			annotation === null ||
			typeof ( annotation as StudioVisualAnnotationSummary ).comment !== 'string' ||
			! ( annotation as StudioVisualAnnotationSummary ).comment.trim() ||
			( annotation as StudioVisualAnnotationSummary ).comment.length > MAX_COMMENT_LENGTH
		) {
			throw new Error( 'Invalid visual annotation.' );
		}
		const typed = annotation as StudioVisualAnnotationSummary;
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
			tag: typed.tag?.trim() || undefined,
			elementLabel: typed.elementLabel?.trim() || undefined,
			nearbyText: typed.nearbyText?.trim() || undefined,
		};
	} );
}
