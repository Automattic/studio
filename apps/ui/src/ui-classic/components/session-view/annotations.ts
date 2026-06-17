import { _n, sprintf } from '@wordpress/i18n';
import type { Annotation } from '@/components/site-preview/types';

function describeCount( count: number ): string {
	return count === 1 ? '1 visual annotation' : `${ count } visual annotations`;
}

export function formatAnnotationsSubmittedMessage( count: number ): string {
	return sprintf( _n( '%d annotation submitted', '%d annotations submitted', count ), count );
}

function truncateText( text: string, maxLength: number ): string {
	if ( text.length <= maxLength ) {
		return text;
	}
	return `${ text.slice( 0, maxLength - 1 ) }...`;
}

function stringifyAnnotation( annotation: Annotation ): string {
	return JSON.stringify( annotation, null, 2 );
}

/**
 * Builds the submitted annotation prompt for the agent. The prompt mirrors the
 * CLI `/annotate` workflow: create a TodoWrite list, then make the site changes.
 */
export function formatAnnotationsAsPrompt( annotations: Annotation[] ): string {
	const lines: string[] = [
		`The user submitted ${ describeCount( annotations.length ) } from the site preview.`,
		'',
		'Call `TodoWrite` (the Todo tool) with one task for each annotation, then make the requested changes and keep the todo list updated as you complete the work.',
		'',
		'When you reference an annotation for the user, identify the element by what is visible on the page rather than by selector. Use selectors and raw annotation data only for implementation.',
		'',
		'## Submitted Annotations',
		'',
	];

	annotations.forEach( ( annotation, index ) => {
		const tag = annotation.tag ? `<${ annotation.tag }>` : 'element';
		const nearbyText =
			typeof annotation.nearbyText === 'string' && annotation.nearbyText.trim()
				? ` - "${ truncateText( annotation.nearbyText.trim(), 120 ) }"`
				: '';
		const page = annotation.url || annotation.pathname || '/';

		lines.push(
			`### ${ index + 1 }. ${ tag }${ nearbyText }`,
			`- Page: ${ page }`,
			`- Comment: ${ annotation.comment }`
		);

		if ( annotation.selector ) {
			lines.push( `- Selector: \`${ annotation.selector }\`` );
		}

		lines.push( '', '```json', stringifyAnnotation( annotation ), '```', '' );
	} );

	return lines.join( '\n' ).trimEnd();
}
