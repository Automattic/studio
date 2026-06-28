import { Type } from 'typebox';
import { getSharedBrowser } from 'cli/ai/browser-utils';
import { emitProgress } from 'cli/logger';
import { defineTool } from './define-tool';
import { textResult } from './utils';

/**
 * Viewports mirror `take_screenshot` so the DOM the agent inspects matches the
 * pixels it sees. Layout-dependent issues (constrained width, column stacking)
 * differ between desktop and mobile, so the agent picks the one it is
 * diagnosing.
 */
const INSPECT_VIEWPORTS = {
	desktop: { width: 1040, height: 1248 },
	mobile: { width: 390, height: 844 },
} as const;

type InspectViewport = keyof typeof INSPECT_VIEWPORTS;

/**
 * Curated, design-relevant computed-style properties. The full computed style
 * is hundreds of properties; this set covers the layout, box, background,
 * typography, flex/grid, and interaction concerns the polish loop reasons
 * about, while keeping the tool output small. WordPress layout custom
 * properties (block gap) are read separately via getPropertyValue.
 */
const COMPUTED_PROPERTIES = [
	'display',
	'position',
	'width',
	'height',
	'max-width',
	'min-height',
	'box-sizing',
	'margin-top',
	'margin-right',
	'margin-bottom',
	'margin-left',
	'padding-top',
	'padding-right',
	'padding-bottom',
	'padding-left',
	'background-color',
	'background-image',
	'color',
	'border-top-width',
	'border-style',
	'border-color',
	'border-radius',
	'box-shadow',
	'opacity',
	'font-family',
	'font-size',
	'font-weight',
	'line-height',
	'letter-spacing',
	'text-align',
	'text-decoration-line',
	'flex-direction',
	'flex-wrap',
	'justify-content',
	'align-items',
	'gap',
	'column-gap',
	'row-gap',
	'grid-template-columns',
	'transform',
	'transition',
	'cursor',
] as const;

/**
 * WordPress layout selectors resolve block spacing through this custom
 * property. Reading it on a section explains gaps that "don't match" the CSS
 * the agent wrote, since `:where(.is-layout-flow) > * + *` owns the spacing.
 */
const CUSTOM_PROPERTIES = [ '--wp--style--block-gap' ] as const;

const MAX_MATCHES_PER_SELECTOR = 5;
const HTML_PREVIEW_LENGTH = 400;
const ANCESTOR_DEPTH = 6;

export const inspectDesignTool = defineTool(
	'inspect_design',
	'Inspects the RENDERED DOM of a live page to diagnose visual issues at their root cause. ' +
		"Given CSS selectors, returns each matched element's tag and class list, bounding box (so you can see actual rendered width/height vs intent), " +
		'curated computed styles (box model, background, typography, flex/grid, borders), the WordPress block-gap custom property, ' +
		'and the ancestor chain of layout classes (is-layout-constrained, alignfull, wp-block-group) that controls width and spacing. ' +
		'Pass `includeHover: true` to also capture computed styles while hovering the first match — use this for button/link hover states. ' +
		'Pair this with take_screenshot: the screenshot shows the symptom, inspect_design shows the cause. ' +
		'Pass `colorScheme: "light"` or `colorScheme: "dark"` to inspect styles under the same prefers-color-scheme mode used by take_screenshot. ' +
		'Use it before editing CSS so you target the element that actually carries the style (e.g. .wp-block-button__link, not the .wp-block-button wrapper) instead of guessing.',
	{
		url: Type.String( { description: 'The URL of the running site page to inspect' } ),
		selectors: Type.Array( Type.String(), {
			minItems: 1,
			description:
				'CSS selectors to inspect, e.g. [".hero", ".wp-block-button", ".wp-block-button__link", ".wp-block-column"]. Each is queried against the rendered page.',
		} ),
		viewport: Type.Optional(
			Type.Enum( [ 'desktop', 'mobile' ], {
				description:
					'Viewport to render at: "desktop" (1040px wide) or "mobile" (390px wide). Defaults to desktop. Use "mobile" to diagnose responsive issues.',
			} )
		),
		includeHover: Type.Optional(
			Type.Boolean( {
				description:
					'When true, also captures the computed styles of the first match of each selector while it is hovered. Use for button/link hover diagnosis.',
			} )
		),
		colorScheme: Type.Optional(
			Type.Enum( [ 'light', 'dark' ], {
				description:
					'Color scheme to emulate: "light" or "dark". Defaults to the browser/system preference.',
			} )
		),
	},
	async ( args ) => {
		const viewport: InspectViewport = ( args.viewport as InspectViewport ) ?? 'desktop';
		emitProgress(
			`Inspecting ${ args.selectors.length } selector(s) on ${ args.url } (${ viewport }${
				args.colorScheme ? `, ${ args.colorScheme }` : ''
			})…`
		);

		const browser = await getSharedBrowser();
		const page = await browser.newPage( {
			viewport: INSPECT_VIEWPORTS[ viewport ],
			ignoreHTTPSErrors: true,
		} );

		try {
			await page.emulateMedia( {
				reducedMotion: 'reduce',
				...( args.colorScheme ? { colorScheme: args.colorScheme } : {} ),
			} );
			await page.goto( args.url, { waitUntil: 'domcontentloaded', timeout: 30000 } );
			await page.waitForLoadState( 'networkidle', { timeout: 2500 } ).catch( () => {} );
			await page.evaluate(
				() => new Promise< void >( ( resolve ) => requestAnimationFrame( () => resolve() ) )
			);

			const report = await page.evaluate(
				( {
					selectors,
					properties,
					customProperties,
					maxMatches,
					htmlPreviewLength,
					ancestorDepth,
				} ) => {
					const describeNode = ( el: Element ) => {
						const classList = Array.from( el.classList );
						const style = getComputedStyle( el );
						const computed: Record< string, string > = {};
						for ( const prop of properties ) {
							computed[ prop ] = style.getPropertyValue( prop ).trim();
						}
						const custom: Record< string, string > = {};
						for ( const prop of customProperties ) {
							const value = style.getPropertyValue( prop ).trim();
							if ( value ) {
								custom[ prop ] = value;
							}
						}
						const rect = el.getBoundingClientRect();
						const html = el.outerHTML;
						return {
							tag: el.tagName.toLowerCase(),
							id: el.id || undefined,
							classes: classList,
							boundingBox: {
								x: Math.round( rect.x ),
								y: Math.round( rect.y ),
								width: Math.round( rect.width ),
								height: Math.round( rect.height ),
							},
							computedStyle: computed,
							customProperties: Object.keys( custom ).length ? custom : undefined,
							outerHTMLPreview:
								html.length > htmlPreviewLength ? html.slice( 0, htmlPreviewLength ) + '…' : html,
						};
					};

					const ancestorChain = ( el: Element ): string[] => {
						const chain: string[] = [];
						let current = el.parentElement;
						let depth = 0;
						while ( current && current.tagName !== 'HTML' && depth < ancestorDepth ) {
							const classes = Array.from( current.classList );
							chain.push(
								`${ current.tagName.toLowerCase() }${
									classes.length ? '.' + classes.join( '.' ) : ''
								}`
							);
							current = current.parentElement;
							depth++;
						}
						return chain;
					};

					return selectors.map( ( selector ) => {
						let elements: Element[];
						try {
							elements = Array.from( document.querySelectorAll( selector ) );
						} catch ( error ) {
							return {
								selector,
								error: `Invalid selector: ${
									error instanceof Error ? error.message : String( error )
								}`,
							};
						}
						return {
							selector,
							matchCount: elements.length,
							matches: elements.slice( 0, maxMatches ).map( ( el, index ) => ( {
								...describeNode( el ),
								ancestors: index === 0 ? ancestorChain( el ) : undefined,
							} ) ),
						};
					} );
				},
				{
					selectors: args.selectors,
					properties: COMPUTED_PROPERTIES as readonly string[] as string[],
					customProperties: CUSTOM_PROPERTIES as readonly string[] as string[],
					maxMatches: MAX_MATCHES_PER_SELECTOR,
					htmlPreviewLength: HTML_PREVIEW_LENGTH,
					ancestorDepth: ANCESTOR_DEPTH,
				}
			);

			let hover:
				| Array< { selector: string; computedStyle?: Record< string, string >; error?: string } >
				| undefined;
			if ( args.includeHover ) {
				hover = [];
				for ( const selector of args.selectors ) {
					try {
						await page.hover( selector, { timeout: 2000 } );
						const computedStyle = await page.evaluate(
							( { sel, properties } ) => {
								const el = document.querySelector( sel );
								if ( ! el ) {
									return undefined;
								}
								const style = getComputedStyle( el );
								const computed: Record< string, string > = {};
								for ( const prop of properties ) {
									computed[ prop ] = style.getPropertyValue( prop ).trim();
								}
								return computed;
							},
							{ sel: selector, properties: COMPUTED_PROPERTIES as readonly string[] as string[] }
						);
						hover.push( { selector, computedStyle } );
						await page.mouse.move( 0, 0 );
					} catch ( error ) {
						hover.push( {
							selector,
							error: `Could not hover: ${
								error instanceof Error ? error.message : String( error )
							}`,
						} );
					}
				}
			}

			emitProgress( `Inspected ${ args.selectors.length } selector(s) on ${ args.url }` );
			return textResult(
				JSON.stringify(
					{
						url: args.url,
						viewport,
						viewportWidth: INSPECT_VIEWPORTS[ viewport ].width,
						...( args.colorScheme ? { colorScheme: args.colorScheme } : {} ),
						selectors: report,
						...( hover ? { hover } : {} ),
					},
					null,
					2
				)
			);
		} catch ( error ) {
			throw new Error(
				`Design inspection failed: ${ error instanceof Error ? error.message : String( error ) }`
			);
		} finally {
			await page.close();
		}
	}
);
