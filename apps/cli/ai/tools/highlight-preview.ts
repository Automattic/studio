import { Type } from 'typebox';
import { emitEvent } from 'cli/ai/json-events';
import { defineTool } from './define-tool';
import { textResult } from './utils';

/**
 * The reverse of the user's clips: the agent points at elements in the
 * Studio app's site preview. The desktop renderer resolves the selectors in
 * the previewed page and draws pulsing highlight markers (distinct from the
 * user's numbered clip markers).
 */
export const highlightPreviewTool = defineTool(
	'highlight_in_preview',
	'Highlights elements in the site preview inside the Studio app, so the user can see exactly ' +
		'what you are referring to — e.g. after changing something ("I updated this heading") or ' +
		'when asking the user to choose between elements. Pass CSS selectors for the elements on ' +
		'the CURRENTLY previewed page, with short labels. Highlights replace the previous set; ' +
		'call with an empty array to clear them. Only works while the desktop app preview is open; ' +
		'harmless otherwise.',
	{
		markers: Type.Array(
			Type.Object( {
				selector: Type.String( {
					description: 'CSS selector for the element to highlight (resolved in the page).',
				} ),
				label: Type.Optional(
					Type.String( { description: 'Short label shown above the highlight (e.g. "Updated").' } )
				),
			} ),
			{ description: 'Elements to highlight. An empty array clears existing highlights.' }
		),
	},
	async ( args ) => {
		emitEvent( {
			type: 'preview.highlight',
			timestamp: new Date().toISOString(),
			markers: args.markers.map( ( marker, index ) => ( {
				id: `agent-${ index + 1 }`,
				selector: marker.selector,
				label: marker.label,
			} ) ),
		} );
		return textResult(
			args.markers.length === 0
				? 'Cleared preview highlights.'
				: `Highlighted ${ args.markers.length } element(s) in the site preview.`
		);
	}
);
