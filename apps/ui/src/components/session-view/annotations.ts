import { _n, sprintf } from '@wordpress/i18n';
import type { Annotation } from '@/components/site-preview/types';
import type { StudioVisualAnnotationSummary } from '@studio/common/ai/visual-annotations';

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

/* Short CSS-ish handle for the chip in the transcript: the tag plus up to two
 * of the element's own classes, e.g. `h1.hero-title`. */
function describeElement( annotation: Annotation ): string | undefined {
	if ( typeof annotation.designToken === 'string' ) return annotation.designToken;
	if ( ! annotation.tag ) return undefined;
	const classes = ( annotation.classes ?? [] ).slice( 0, 2 );
	return classes.length ? `${ annotation.tag }.${ classes.join( '.' ) }` : `<${ annotation.tag }>`;
}

export function toVisualAnnotationSummaries(
	annotations: Annotation[]
): StudioVisualAnnotationSummary[] {
	return annotations.map( ( annotation ) => ( {
		comment: annotation.comment,
		tag: annotation.tag,
		elementLabel: describeElement( annotation ),
		nearbyText: annotation.nearbyText?.trim()
			? truncateText( annotation.nearbyText.trim(), 120 )
			: undefined,
	} ) );
}

function isDesignSystemAnnotation( annotation: Annotation ): boolean {
	return annotation.path === 'DESIGN.md';
}

function stringifyAnnotation( annotation: Annotation ): string {
	return JSON.stringify( annotation, null, 2 );
}

/**
 * Builds the submitted annotation prompt for the agent. The prompt mirrors the
 * CLI `/annotate` workflow: act on the submitted annotations directly.
 */
export function formatAnnotationsAsPrompt( annotations: Annotation[] ): string {
	const lines: string[] = [
		`The user submitted ${ describeCount( annotations.length ) } from the site preview.`,
		'',
		'Make the requested changes. When there are several annotations, address them in the order they were submitted.',
		'',
		'When you reference an annotation for the user, identify the element by what is visible on the page rather than by selector. Use selectors and raw annotation data only for implementation.',
		'',
	];
	if ( annotations.some( isDesignSystemAnnotation ) ) {
		lines.push(
			"Annotations from the Design system page are about the site's DESIGN.md: make the change there, then update the matching presets in the active theme's theme.json so the site follows it.",
			''
		);
	}
	lines.push( '## Submitted Annotations', '' );

	annotations.forEach( ( annotation, index ) => {
		const token = typeof annotation.designToken === 'string' ? annotation.designToken : undefined;
		const tag = token
			? `design token \`${ token }\``
			: annotation.tag
			? `<${ annotation.tag }>`
			: 'element';
		const nearbyText =
			typeof annotation.nearbyText === 'string' && annotation.nearbyText.trim()
				? ` - "${ truncateText( annotation.nearbyText.trim(), 120 ) }"`
				: '';
		const page = isDesignSystemAnnotation( annotation )
			? 'Design system (DESIGN.md)'
			: annotation.url || annotation.path || '/';

		lines.push(
			`### ${ index + 1 }. ${ tag }${ nearbyText }`,
			`- Page: ${ page }`,
			`- Comment: ${ annotation.comment }`
		);

		if ( annotation.selector ) {
			lines.push( `- Selector: \`${ annotation.selector }\`` );
		}

		if ( annotation.viewport ) {
			lines.push(
				`- Viewport when annotated: ${ annotation.viewport.width }×${ annotation.viewport.height } CSS px`
			);
		}

		lines.push( '', '```json', stringifyAnnotation( annotation ), '```', '' );
	} );

	return lines.join( '\n' ).trimEnd();
}
