const MAX_ANNOTATIONS = 100;
const MAX_SERIALIZED_LENGTH = 1_000_000;

const ALLOWED_ANNOTATION_FIELDS = new Set( [
	'id',
	'comment',
	'selector',
	'tag',
	'elementLabel',
	'nearbyText',
	'url',
	'pathname',
	'timestamp',
	'updatedAt',
	'boundingBox',
	'documentRect',
	'computedStyles',
] );

export interface StudioInspectorRect {
	x?: number;
	y?: number;
	left?: number;
	top?: number;
	width: number;
	height: number;
}

export interface StudioInspectorAnnotation {
	id: string;
	comment: string;
	selector?: string;
	tag?: string;
	elementLabel?: string;
	nearbyText?: string;
	url?: string;
	pathname?: string;
	timestamp?: number;
	updatedAt?: number;
	boundingBox?: StudioInspectorRect;
	documentRect?: StudioInspectorRect;
	computedStyles?: Record< string, string >;
}

const OPTIONAL_STRING_LIMITS = {
	selector: 10_000,
	tag: 100,
	elementLabel: 500,
	nearbyText: 1_000,
	url: 10_000,
	pathname: 10_000,
} as const;

function isFiniteNumber( value: unknown ): value is number {
	return typeof value === 'number' && Number.isFinite( value );
}

function validateRect( value: unknown ): void {
	if ( typeof value !== 'object' || value === null ) {
		throw new Error( 'Invalid inspector annotation.' );
	}
	const rect = value as Record< string, unknown >;
	const allowedFields = new Set( [ 'x', 'y', 'left', 'top', 'width', 'height' ] );
	if (
		Object.keys( rect ).some( ( field ) => ! allowedFields.has( field ) ) ||
		! isFiniteNumber( rect.width ) ||
		! isFiniteNumber( rect.height ) ||
		[ 'x', 'y', 'left', 'top' ].some(
			( field ) => rect[ field ] !== undefined && ! isFiniteNumber( rect[ field ] )
		)
	) {
		throw new Error( 'Invalid inspector annotation.' );
	}
}

function validateComputedStyles( value: unknown ): void {
	if ( typeof value !== 'object' || value === null || Array.isArray( value ) ) {
		throw new Error( 'Invalid inspector annotation.' );
	}
	const entries = Object.entries( value );
	if (
		entries.length > 50 ||
		entries.some(
			( [ property, propertyValue ] ) =>
				property.length > 100 || typeof propertyValue !== 'string' || propertyValue.length > 1_000
		)
	) {
		throw new Error( 'Invalid inspector annotation.' );
	}
}

export function validateStudioInspectorAnnotations( value: unknown ): StudioInspectorAnnotation[] {
	if ( ! Array.isArray( value ) || value.length === 0 || value.length > MAX_ANNOTATIONS ) {
		throw new Error( 'Invalid inspector annotations.' );
	}

	let serializedLength: number;
	try {
		serializedLength = JSON.stringify( value ).length;
	} catch {
		throw new Error( 'Invalid inspector annotations.' );
	}
	if ( serializedLength > MAX_SERIALIZED_LENGTH ) {
		throw new Error( 'Inspector annotations contain too much data.' );
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
		if ( Object.keys( annotation ).some( ( field ) => ! ALLOWED_ANNOTATION_FIELDS.has( field ) ) ) {
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
			[ annotation.timestamp, annotation.updatedAt ].some(
				( timestamp ) => timestamp !== undefined && ! isFiniteNumber( timestamp )
			)
		) {
			throw new Error( 'Invalid inspector annotation.' );
		}
		if ( annotation.boundingBox !== undefined ) {
			validateRect( annotation.boundingBox );
		}
		if ( annotation.documentRect !== undefined ) {
			validateRect( annotation.documentRect );
		}
		if ( annotation.computedStyles !== undefined ) {
			validateComputedStyles( annotation.computedStyles );
		}
	}

	return value as StudioInspectorAnnotation[];
}
