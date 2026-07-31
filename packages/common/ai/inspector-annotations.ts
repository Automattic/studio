const MAX_ANNOTATIONS = 100;
const MAX_SERIALIZED_LENGTH = 1_000_000;

export interface StudioInspectorAnnotation extends Record< string, unknown > {
	id: string;
	comment: string;
	selector?: string;
	tag?: string;
	elementLabel?: string;
	nearbyText?: string;
	url?: string;
	pathname?: string;
	timestamp?: number;
}

const OPTIONAL_STRING_LIMITS = {
	selector: 10_000,
	tag: 100,
	elementLabel: 500,
	nearbyText: 1_000,
	url: 10_000,
	pathname: 10_000,
} as const;

export function validateStudioInspectorAnnotations( value: unknown ): StudioInspectorAnnotation[] {
	if ( ! Array.isArray( value ) || value.length === 0 || value.length > MAX_ANNOTATIONS ) {
		throw new Error( 'Invalid inspector annotations.' );
	}

	for ( const annotation of value ) {
		if (
			typeof annotation !== 'object' ||
			annotation === null ||
			typeof annotation.id !== 'string' ||
			! annotation.id ||
			annotation.id.length > 200 ||
			typeof annotation.comment !== 'string' ||
			! annotation.comment.trim() ||
			annotation.comment.length > 10_000
		) {
			throw new Error( 'Invalid inspector annotation.' );
		}
		for ( const field of Object.keys( OPTIONAL_STRING_LIMITS ) as Array<
			keyof typeof OPTIONAL_STRING_LIMITS
		> ) {
			const fieldValue = annotation[ field ];
			if (
				fieldValue !== undefined &&
				( typeof fieldValue !== 'string' || fieldValue.length > OPTIONAL_STRING_LIMITS[ field ] )
			) {
				throw new Error( 'Invalid inspector annotation.' );
			}
		}
		if (
			annotation.timestamp !== undefined &&
			( typeof annotation.timestamp !== 'number' || ! Number.isFinite( annotation.timestamp ) )
		) {
			throw new Error( 'Invalid inspector annotation.' );
		}
	}

	if ( JSON.stringify( value ).length > MAX_SERIALIZED_LENGTH ) {
		throw new Error( 'Inspector annotations contain too much data.' );
	}

	return value as StudioInspectorAnnotation[];
}
