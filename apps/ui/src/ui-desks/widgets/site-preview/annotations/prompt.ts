import { _n, sprintf } from '@wordpress/i18n';
import type { DeskWidget } from '@/ui-desks/widgets/types';

export interface DeskSitePreviewAnnotation {
	id: string;
	comment: string;
	selector?: string;
	tag?: string;
	nearbyText?: string;
	url?: string;
	pathname?: string;
	timestamp?: number;
	[ key: string ]: unknown;
}

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

function stringifyAnnotation( annotation: DeskSitePreviewAnnotation ): string {
	return JSON.stringify( annotation, null, 2 );
}

/**
 * Builds the submitted annotation prompt for the agent. Keep this local to
 * desks so its workflow can diverge from classic UI without shared coupling.
 */
export function formatAnnotationsAsPrompt( annotations: DeskSitePreviewAnnotation[] ): string {
	const lines: string[] = [
		`The user submitted ${ describeCount( annotations.length ) } from the site preview.`,
		'',
		'Make the requested changes. When there are several annotations, address them in the order they were submitted.',
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

export function createAnnotationWidgetContextPrompt( userPrompt: string, widgets: DeskWidget[] ) {
	const context = widgets
		.map(
			( widget, index ) =>
				`${ index + 1 }. ${ JSON.stringify( {
					widgetId: widget.id,
					type: widget.type,
					position: {
						x: widget.x,
						y: widget.y,
					},
					widgetProps: widget.widgetProps,
				} ) }`
		)
		.join( '\n' );

	return [
		'Use the following Studio canvas selection as context.',
		'The selected items are canvas widgets. Refer to widget IDs and WordPress entity IDs when helpful.',
		'',
		context,
		'',
		'User request:',
		userPrompt,
	].join( '\n' );
}
