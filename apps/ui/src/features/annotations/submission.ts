import { validateStudioChatImages } from '@studio/common/ai/chat-images';
import {
	toComposerSendAttachments,
	type ComposerAttachment,
	type ComposerFileAttachment,
} from '@studio/common/ai/composer-attachments';
import {
	formatVisualAnnotationsPrompt,
	MAX_VISUAL_ANNOTATIONS,
	validateStudioVisualAnnotations,
	type StudioVisualAnnotationSummary,
} from '@studio/common/ai/visual-annotations';
import { __, _n, sprintf } from '@wordpress/i18n';
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
	if ( note.email && ! note.tag ) return `paragraph ${ ( note.email.paragraph ?? 0 ) + 1 }`;
	if ( ! note.tag ) return undefined;
	const classes = ( note.classes ?? [] ).slice( 0, 2 );
	return classes.length ? `${ note.tag }.${ classes.join( '.' ) }` : `<${ note.tag }>`;
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
	if ( visualAnnotations.length > MAX_VISUAL_ANNOTATIONS ) {
		throw new Error(
			sprintf(
				/* translators: %d: maximum number of annotations in one message. */
				__(
					'You can send up to %d annotations at once. Send fewer annotations or send your message separately.'
				),
				MAX_VISUAL_ANNOTATIONS
			)
		);
	}
	validateStudioChatImages( images );
	validateStudioVisualAnnotations( visualAnnotations, images );
	return {
		prompt: [
			message,
			formatVisualAnnotationsPrompt(
				notes.map( ( { staged: _staged, ...note } ) => note ),
				images
			),
		]
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
