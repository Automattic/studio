import { Type } from 'typebox';
import { getSharedBrowser } from 'cli/ai/browser-utils';
import { emitProgress } from 'cli/logger';
import { defineTool } from './define-tool';
import { VIEWPORTS } from './screenshot-helpers';

/**
 * Layout-relevant computed style properties. Kept small and intentional: these
 * are the ones that explain "why isn't this a 3-column grid" without drowning
 * the agent in every CSS property. Mirrored in the browser-side evaluate.
 */
const MEASURED_STYLE_PROPS = [
	'display',
	'position',
	'gridTemplateColumns',
	'gridTemplateRows',
	'gridAutoFlow',
	'flexDirection',
	'flexWrap',
	'justifyContent',
	'alignItems',
	'columnGap',
	'rowGap',
	'width',
	'maxWidth',
	'overflow',
	'visibility',
] as const;

export interface MeasuredElement {
	tagName: string;
	className: string;
	rect: { x: number; y: number; width: number; height: number };
	styles: Record< string, string >;
}

/**
 * Render the structured measurement into the text block handed back to the
 * model. Pure (no browser) so it is unit-testable.
 */
export function formatMeasureResult(
	url: string,
	selector: string,
	total: number,
	elements: MeasuredElement[]
): string {
	if ( total === 0 ) {
		return `No elements matched "${ selector }" at ${ url }. Check the selector against the rendered HTML — the class/tag may differ from the block markup (WordPress adds classes like \`is-layout-grid\`, \`wp-block-columns\`).`;
	}

	const header =
		elements.length < total
			? `${ total } elements matched "${ selector }" at ${ url } (showing the first ${ elements.length }):`
			: `${ total } element(s) matched "${ selector }" at ${ url }:`;

	const blocks = elements.map( ( el, index ) => {
		const rect = `rect: ${ el.rect.width }×${ el.rect.height } at (${ el.rect.x }, ${ el.rect.y })`;
		const styleLines = Object.entries( el.styles )
			.map( ( [ key, value ] ) => `    ${ key }: ${ value }` )
			.join( '\n' );
		const classes = el.className ? ` .${ el.className.split( /\s+/ ).join( '.' ) }` : '';
		return `[${ index }] <${ el.tagName }${ classes }>\n  ${ rect }\n${ styleLines }`;
	} );

	return `${ header }\n\n${ blocks.join( '\n\n' ) }`;
}

export const measureElementsTool = defineTool(
	'measure_elements',
	'Measures how elements actually render on a page: their box (position + size) and key layout computed styles ' +
		'(display, grid-template-columns, flex-wrap, gaps, width, overflow, visibility). ' +
		'Use this to get ground truth about layout instead of guessing from a screenshot — e.g. to confirm a grid ' +
		'is really rendering as 3 columns (`grid-template-columns`), why columns wrap, or whether an element is ' +
		'visible and how wide it is. Measured at the desktop viewport. Provide a CSS selector matching the rendered ' +
		'HTML (inspect it first if unsure — WordPress adds classes like `is-layout-grid` and `wp-block-columns`).',
	{
		url: Type.String( { description: 'The URL to measure.' } ),
		selector: Type.String( {
			description:
				'CSS selector for the element(s) to measure, e.g. ".features-grid" or ".wp-block-columns".',
		} ),
		limit: Type.Optional(
			Type.Number( {
				minimum: 1,
				maximum: 50,
				description: 'Maximum number of matching elements to report. Defaults to 12.',
			} )
		),
	},
	async ( args ) => {
		const limit = Math.min( Math.max( Math.floor( args.limit ?? 12 ), 1 ), 50 );
		emitProgress( `Measuring "${ args.selector }" at ${ args.url }…` );

		const browser = await getSharedBrowser();
		const page = await browser.newPage( { viewport: VIEWPORTS.desktop } );
		try {
			await page.goto( args.url, { waitUntil: 'domcontentloaded', timeout: 30000 } );
			await page.waitForLoadState( 'networkidle', { timeout: 2500 } ).catch( () => {} );

			const { total, elements } = await page.evaluate(
				( { selector, limit, props }: { selector: string; limit: number; props: string[] } ) => {
					const matches = Array.from( document.querySelectorAll( selector ) );
					const round = ( n: number ) => Math.round( n );
					const elements = matches.slice( 0, limit ).map( ( node ) => {
						const element = node as HTMLElement;
						const rect = element.getBoundingClientRect();
						const computed = window.getComputedStyle( element );
						const styles: Record< string, string > = {};
						for ( const prop of props ) {
							styles[ prop ] = computed.getPropertyValue(
								prop.replace( /[A-Z]/g, ( m ) => `-${ m.toLowerCase() }` )
							);
						}
						return {
							tagName: element.tagName.toLowerCase(),
							className: typeof element.className === 'string' ? element.className : '',
							rect: {
								x: round( rect.x ),
								y: round( rect.y ),
								width: round( rect.width ),
								height: round( rect.height ),
							},
							styles,
						};
					} );
					return { total: matches.length, elements };
				},
				{ selector: args.selector, limit, props: [ ...MEASURED_STYLE_PROPS ] }
			);

			emitProgress( `Measured ${ total } element(s)` );
			return {
				content: [
					{
						type: 'text' as const,
						text: formatMeasureResult( args.url, args.selector, total, elements ),
					},
				],
			};
		} catch ( error ) {
			throw new Error(
				`Could not measure ${ args.url }: ${
					error instanceof Error ? error.message : String( error )
				}`
			);
		} finally {
			await page.close();
		}
	}
);
