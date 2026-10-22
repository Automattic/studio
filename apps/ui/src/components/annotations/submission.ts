import { validateStudioChatImages } from '@studio/common/ai/chat-images';
import {
	toComposerSendAttachments,
	type ComposerAttachment,
	type ComposerFileAttachment,
} from '@studio/common/ai/composer-attachments';
import {
	validateStudioVisualAnnotations,
	type StudioVisualAnnotationSummary,
} from '@studio/common/ai/visual-annotations';
import { _n, sprintf } from '@wordpress/i18n';
import type { PreviewAnnotation } from './store';

function truncateText( text: string, maxLength: number ): string {
	if ( text.length <= maxLength ) {
		return text;
	}
	return `${ text.slice( 0, maxLength - 1 ) }...`;
}

/* Short CSS-ish handle for the chip in the transcript: the tag plus up to two
 * of the element's own classes, e.g. `h1.hero-title`. */
function describeElement( note: PreviewAnnotation ): string | undefined {
	if ( note.designToken ) return note.designToken;
	if ( ! note.tag ) return undefined;
	const classes = ( note.classes ?? [] ).slice( 0, 2 );
	return classes.length ? `${ note.tag }.${ classes.join( '.' ) }` : `<${ note.tag }>`;
}

function isDesignSystemAnnotation( note: PreviewAnnotation ): boolean {
	return note.path === 'DESIGN.md';
}

function formatAnnotationsAsPrompt(
	notes: PreviewAnnotation[],
	imageNumbers: ( note: PreviewAnnotation ) => number[]
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
	if ( notes.some( isDesignSystemAnnotation ) ) {
		lines.push(
			"Annotations from the Design system page are about the site's DESIGN.md: make the change there, then update the matching presets in the active theme's theme.json so the site follows it.",
			''
		);
	}
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
		const page = isDesignSystemAnnotation( note )
			? 'Design system (DESIGN.md)'
			: note.url || note.path || '/';
		const images = imageNumbers( note );
		const { images: _images, staged: _staged, number: _number, designKey: _key, ...data } = note;

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
		if ( images.length ) {
			lines.push( `- Attached images (in attachment order): ${ images.join( ', ' ) }` );
		}
		lines.push( '', '```json', JSON.stringify( data, null, 2 ), '```', '' );
	} );

	return lines.join( '\n' ).trimEnd();
}

/**
 * The message for a send that carries annotations: the composer's own text and
 * attachments first, then each note. Every note becomes its own bubble in the
 * transcript, with the images attached to it.
 */
export function annotationSubmission(
	text: string,
	attachments: ComposerAttachment[],
	notes: PreviewAnnotation[]
) {
	const ordinary = toComposerSendAttachments( attachments );
	const noteImages = toComposerSendAttachments( notes.flatMap( ( note ) => note.images ) ).images;
	const images = [ ...ordinary.images, ...noteImages ];
	const imageNumbers = ( note: PreviewAnnotation ) =>
		note.images.map( ( image ) => images.findIndex( ( item ) => item.id === image.id ) + 1 );
	const message = text.trim();
	const visualAnnotations: StudioVisualAnnotationSummary[] = notes.map( ( note ) => ( {
		comment: note.comment.trim(),
		tag: note.tag,
		elementLabel: describeElement( note ),
		nearbyText: note.nearbyText?.trim() ? truncateText( note.nearbyText.trim(), 120 ) : undefined,
		...( note.images.length ? { imageIds: note.images.map( ( image ) => image.id ) } : {} ),
	} ) );
	if ( message || ordinary.images.length ) {
		visualAnnotations.unshift( {
			comment: message,
			...( ordinary.images.length
				? { imageIds: ordinary.images.map( ( image ) => image.id ) }
				: {} ),
		} );
	}
	validateStudioChatImages( images );
	validateStudioVisualAnnotations( visualAnnotations, images );
	return {
		prompt: [ message, formatAnnotationsAsPrompt( notes, imageNumbers ) ]
			.filter( Boolean )
			.join( '\n\n' ),
		options: {
			displayMessage:
				message ||
				sprintf(
					_n( '%d annotation submitted', '%d annotations submitted', notes.length ),
					notes.length
				),
			images,
			files: ordinary.files,
			visualAnnotations,
		},
	};
}

// The staged notes, as one attachment in the chat composer.
export function getAnnotationsAttachment( notes: PreviewAnnotation[] ): ComposerFileAttachment {
	const text = notes
		.map( ( note, index ) => {
			const images = note.images.length
				? sprintf(
						_n( '%d attached image', '%d attached images', note.images.length ),
						note.images.length
				  )
				: '';
			return `${ index + 1 }. ${ [ note.comment.trim(), images ].filter( Boolean ).join( '\n' ) }`;
		} )
		.join( '\n\n' );
	return {
		id: 'annotations',
		kind: 'file',
		name: sprintf( _n( '%d annotation', '%d annotations', notes.length ), notes.length ),
		path: '',
		size: new TextEncoder().encode( text ).byteLength,
		preview: { kind: 'text', text },
	};
}
