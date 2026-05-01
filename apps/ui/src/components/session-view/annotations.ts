import type { Annotation } from '@/components/site-preview/types';

function describeCount( count: number ): string {
	return count === 1 ? '1 visual annotation' : `${ count } visual annotations`;
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
 * CLI `/annotate` workflow: summarize first, ask for confirmation, then create
 * a TodoWrite list before making any site changes.
 */
export function formatAnnotationsAsPrompt( annotations: Annotation[] ): string {
	const lines: string[] = [
		`The user submitted ${ describeCount( annotations.length ) } from the site preview.`,
		'',
		'First, reply with a markdown summary of every requested change and ask the user to confirm before editing. Follow this shape:',
		'',
		"Here's what you asked me to change:",
		'',
		'1. <one-line description in your own words> - <visible element and nearby text>',
		'   (your note: "<the user comment, verbatim>")',
		'',
		`Want me to go ahead with these ${ annotations.length } change(s)?`,
		'',
		'Use `AskUserQuestion` for that confirmation with options like "Yes, go ahead", "No, let me re-annotate", and "Skip some - I will tell you which". Do not edit files, run WP-CLI mutations, or change the site until the user explicitly confirms.',
		'',
		'After explicit confirmation, call `TodoWrite` (the Todo tool) with one task for each confirmed annotation, then keep that todo list updated as you complete the work.',
		'',
		'When summarizing for the user, identify elements by what is visible on the page rather than by selector. Use selectors and raw annotation data only for implementation.',
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
