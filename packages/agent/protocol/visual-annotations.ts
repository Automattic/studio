import { STUDIO_CHAT_MAX_IMAGES } from '@studio/agent/protocol/chat-images';

// What a note points at: an element on a site page, or a value of the site's
// Styles on the design system page, named as theme.json names it (a preset by
// its `var:preset|…` reference, a style by its path in `styles`).
export interface VisualAnnotationTarget {
	selector?: string;
	tag?: string;
	classes?: string[];
	nearbyText?: string;
	url?: string;
	path?: string;
	viewport?: { width: number; height: number };
	documentRect?: { left: number; top: number; width: number; height: number };
	// Where the click landed inside the element, as fractions of its box.
	point?: { x: number; y: number };
	computedStyles?: Record< string, string >;
	designToken?: string;
	// Design targets are unique, so picking one again edits its note.
	designKey?: string;
}

export interface VisualAnnotation extends VisualAnnotationTarget {
	id: string;
	number: number;
	comment: string;
	images: ReadonlyArray< { id: string } >;
}

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

function truncateText( text: string, maxLength: number ): string {
	return text.length <= maxLength ? text : `${ text.slice( 0, maxLength - 1 ) }...`;
}

/**
 * The agent's view of the notes. `images` is the message's attachment order,
 * which the notes' images are numbered by.
 */
export function formatVisualAnnotationsPrompt(
	notes: VisualAnnotation[],
	images: ReadonlyArray< { id: string } >
): string {
	const lines: string[] = [
		`The user submitted ${
			notes.length === 1 ? '1 visual annotation' : `${ notes.length } visual annotations`
		} from the site preview.`,
		'',
		'Make the requested changes. When there are several annotations, address them in the order they were submitted.',
		'',
		'When you reference an annotation for the user, identify the element by what is visible on the page rather than by selector. Use selectors and raw annotation data only for implementation.',
		'',
	];
	lines.push( '## Submitted Annotations', '' );

	notes.forEach( ( note, index ) => {
		const tag = note.designToken
			? `design token \`${ note.designToken }\``
			: note.tag
			? `<${ note.tag }>`
			: 'element';
		const nearbyText = note.nearbyText?.trim()
			? ` - "${ truncateText( note.nearbyText.trim(), 120 ) }"`
			: '';
		const page = note.designToken
			? "Design system (the site's Styles)"
			: note.url || note.path || '/';
		const imageNumbers = note.images.map(
			( image ) => images.findIndex( ( item ) => item.id === image.id ) + 1
		);
		const { images: _images, number: _number, designKey: _key, ...data } = note;

		lines.push(
			`### ${ index + 1 }. ${ tag }${ nearbyText }`,
			`- Page: ${ page }`,
			`- Comment: ${ note.comment.trim() }`
		);
		if ( note.selector ) {
			lines.push( `- Selector: \`${ note.selector }\`` );
		}
		if ( note.viewport ) {
			lines.push(
				`- Viewport when annotated: ${ note.viewport.width }×${ note.viewport.height } CSS px`
			);
		}
		if ( imageNumbers.length ) {
			lines.push( `- Attached images (in attachment order): ${ imageNumbers.join( ', ' ) }` );
		}
		lines.push( '', '```json', JSON.stringify( data, null, 2 ), '```', '' );
	} );

	return lines.join( '\n' ).trimEnd();
}
