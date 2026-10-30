import { Type } from 'typebox';
import { defineTool, LOCAL_CHANGE } from './define-tool';
import {
	captureScreenshotBuffer,
	renderedCapture,
	saveScreenshotFile,
	SCREENSHOT_COLOR_SCHEME_VALUES,
	VIEWPORTS,
	type ScreenshotColorScheme,
} from './screenshot-helpers';
import type { StudioToolDefinition } from './define-tool';

const screenshotViewportSchema = Type.Enum( [ 'desktop', 'mobile', 'all' ], {
	description:
		'Viewport size: "desktop" (1040x1248), "mobile" (390x844), or "all" for both. Defaults to all.',
} );
type ScreenshotViewportArgument = 'desktop' | 'mobile' | 'all';
type ScreenshotViewportType = keyof typeof VIEWPORTS;

const screenshotColorSchemeSchema = Type.Enum( [ ...SCREENSHOT_COLOR_SCHEME_VALUES, 'all' ], {
	description:
		'Color scheme to emulate: "light", "dark", or "all" to capture both. Defaults to the browser/system preference.',
} );
type ScreenshotColorSchemeArgument = ScreenshotColorScheme | 'all';

function resolveViewportTypes( viewport?: ScreenshotViewportArgument ): ScreenshotViewportType[] {
	if ( viewport === 'all' ) {
		return [ 'desktop', 'mobile' ];
	}
	return viewport ? [ viewport ] : [ 'desktop', 'mobile' ];
}

function resolveColorSchemes(
	colorScheme?: ScreenshotColorSchemeArgument
): Array< ScreenshotColorScheme | undefined > {
	if ( colorScheme === 'all' ) {
		return [ ...SCREENSHOT_COLOR_SCHEME_VALUES ];
	}
	return [ colorScheme ];
}

interface CaptureTarget {
	// Set when the call captures more than one page, to tell them apart.
	url?: string;
	viewportType: ScreenshotViewportType;
	colorScheme?: ScreenshotColorScheme;
}

function getCaptureLabel( target: CaptureTarget ): string {
	return [ target.url, target.viewportType, target.colorScheme ].filter( Boolean ).join( ' ' );
}

// The pages one call captures, each at every viewport it asks for.
const MAX_URLS = 6;

const TEXT_ONLY_NOTE =
	'This model cannot view images, so the capture is not shown to you; its layout, as the browser rendered it, is.';

// Text-only models still get the tool, to show the user a page, but no image
// block, which they would otherwise describe without seeing.
export function createTakeScreenshotTool( {
	visionEnabled,
	imageLink,
	userSeesCaptures = true,
}: {
	visionEnabled: boolean;
	imageLink?: ( file: string ) => string;
	// False in a terminal session: the user sees only the saved file's path.
	userSeesCaptures?: boolean;
} ) {
	return defineTool(
		'take_screenshot',
		'Takes a screenshot of a URL: the first screen, or the whole page with `fullPage: true`. ' +
			( visionEnabled
				? 'Returns the screenshot as an image that you can analyze visually; tall pages are scaled down to 2000 pixels on their longest side, and the saved file keeps full resolution. '
				: `${ TEXT_ONLY_NOTE } ` ) +
			'Captures desktop and mobile unless `viewport` names one, and every page in `url` when it lists several, all in one call. ' +
			'Pass `colorScheme: "light"`, `colorScheme: "dark"`, or `colorScheme: "all"` for pages that respond to prefers-color-scheme. ' +
			'Full-page captures of long pages are clipped at 8000 vertical pixels; the response reports the document height and whether more remains, and you can call again with `offset` to fetch the next slice. ' +
			'The user sees the site itself, in Studio or their browser, so a capture is yours alone; ' +
			( imageLink
				? 'pass `display: true` for one to show the user, which comes back with image lines to put in your reply.'
				: 'pass `display: true` to show one to the user in the chat as well.' ),
		{
			url: Type.Union(
				[ Type.String(), Type.Array( Type.String(), { minItems: 1, maxItems: MAX_URLS } ) ],
				{ description: `The URL to screenshot, or up to ${ MAX_URLS } URLs to capture together` }
			),
			viewport: Type.Optional( screenshotViewportSchema ),
			colorScheme: Type.Optional( screenshotColorSchemeSchema ),
			fullPage: Type.Optional(
				Type.Boolean( {
					description:
						'Capture the whole page rather than the first screen. Defaults to false; passing `offset` implies it.',
				} )
			),
			display: Type.Optional(
				Type.Boolean( {
					description: 'Whether to show the capture to the user in the chat. Defaults to false.',
				} )
			),
			offset: Type.Optional(
				Type.Number( {
					minimum: 0,
					description:
						'Y-offset in CSS pixels for the capture region. Defaults to 0 (top of page). When a previous call reports the page was clipped, pass `offset` equal to where that capture ended to fetch the next slice.',
				} )
			),
		},
		async ( args, context ) => {
			try {
				const urls = typeof args.url === 'string' ? [ args.url ] : args.url;
				const viewportTypes = resolveViewportTypes( args.viewport );
				const colorSchemes = resolveColorSchemes( args.colorScheme );
				const captureTargets: CaptureTarget[] = urls.flatMap( ( url ) =>
					viewportTypes.flatMap( ( viewportType ) =>
						colorSchemes.map( ( colorScheme ) => ( {
							url: urls.length > 1 ? url : undefined,
							viewportType,
							colorScheme,
						} ) )
					)
				);
				const captureLabel = captureTargets.map( getCaptureLabel ).join( ', ' );
				const fullPage = args.fullPage === true || args.offset !== undefined;
				const display = args.display === true;
				context.onProgress( `Taking ${ captureLabel } screenshot of ${ urls.join( ', ' ) }…` );
				const captures = await Promise.all(
					captureTargets.map( async ( target ) => {
						const { viewportType, colorScheme } = target;
						const url = target.url ?? urls[ 0 ];
						// The page as Studio rendered it after the last change, while it serves the same HTML.
						const rendered =
							visionEnabled && ! colorScheme && ! args.offset
								? await renderedCapture( url, VIEWPORTS[ viewportType ], fullPage )
								: undefined;
						const capture =
							rendered ??
							( await captureScreenshotBuffer( url, VIEWPORTS[ viewportType ], {
								fullPage,
								format: 'jpeg',
								offset: args.offset,
								colorScheme,
								forModel: visionEnabled,
							} ) );
						const screenshotFile = await saveScreenshotFile( context.host, capture.buffer, {
							viewportType,
							format: 'jpeg',
							colorScheme,
						} );
						// Progress lines persist in the CLI transcript (but not in the
						// desktop conversation history, where the inline artifact is the
						// UI), so this is the terminal user's only handle on the file.
						context.onProgress(
							`Saved ${ getCaptureLabel( target ) } screenshot to ${ screenshotFile.fileUrl }`
						);
						return {
							...target,
							requestedUrl: url,
							resolvedUrl: capture.url,
							path: screenshotFile.path,
							buffer: capture.buffer,
							modelImage: capture.modelImage,
							documentHeight: capture.documentHeight,
							contentHeight: capture.contentHeight,
							capturedHeight: capture.capturedHeight,
							offset: capture.offset,
							clipped: capture.clipped,
							layout: capture.layout,
							textFit: capture.textFit,
							mimeType: screenshotFile.mimeType,
							mediaWidgetPayload: {
								type: 'media',
								widgetProps: {
									url: screenshotFile.fileUrl,
									mediaKind: 'image',
									alt: `Screenshot of ${ url } (${ getCaptureLabel( {
										viewportType,
										colorScheme,
									} ) })`,
									mediaId: null,
									source: {
										type: 'local',
										path: screenshotFile.path,
										name: screenshotFile.name,
										mimeType: screenshotFile.mimeType,
									},
								},
							},
						};
					} )
				);
				const describeCapture = ( capture: ( typeof captures )[ number ] ): string => {
					const captureEnd = capture.offset + capture.capturedHeight;
					const label = getCaptureLabel( capture );
					const shown = capture.modelImage
						? `, shown at ${ capture.modelImage.width }x${ capture.modelImage.height }`
						: '';
					if ( ! fullPage ) {
						return `${ label }: captured the first screen (${
							VIEWPORTS[ capture.viewportType ].width
						}x${ capture.capturedHeight }) of a ${
							capture.contentHeight
						}px page${ shown }. Pass fullPage: true for the whole page.`;
					}
					if ( capture.clipped ) {
						return `${ label }: captured rows ${ capture.offset }-${ captureEnd } of a ${ capture.documentHeight }px page${ shown }. Page was clipped; call again with offset:${ captureEnd } to fetch the next slice.`;
					}
					if ( capture.offset > 0 ) {
						return `${ label }: captured rows ${ capture.offset }-${ captureEnd } of a ${ capture.documentHeight }px page${ shown } (end of page).`;
					}
					return `${ label }: captured full page (${ capture.documentHeight }px tall${ shown }).`;
				};
				const captureLines = captures.map( ( capture ) =>
					[
						`${ describeCapture( capture ) } Saved to ${ capture.path }`,
						...( capture.resolvedUrl && capture.resolvedUrl !== new URL( capture.requestedUrl ).href
							? [
									`  Requested ${ capture.requestedUrl }; rendered ${ capture.resolvedUrl } after redirect.`,
							  ]
							: [] ),
						...( capture.layout ?? [] ).map( ( line ) => `  ${ line }` ),
						...( capture.textFit.length
							? [
									'  Text the browser does not fit:',
									...capture.textFit.map( ( line ) => `    ${ line }` ),
							  ]
							: [] ),
					].join( '\n' )
				);
				const textLines =
					captures.length === 1
						? [ `Screenshot captured — ${ captureLines[ 0 ] }` ]
						: [ 'Screenshots captured:', ...captureLines.map( ( line ) => `- ${ line }` ) ];
				if ( ! visionEnabled ) {
					textLines.push( TEXT_ONLY_NOTE );
				}
				if ( ! userSeesCaptures && ! imageLink ) {
					textLines.push( 'The user does not see this capture, only the saved file path.' );
				}
				if ( imageLink && display ) {
					textLines.push(
						'To show the user, put these lines in your reply:',
						...captures.map(
							( capture ) =>
								`![Screenshot (${ getCaptureLabel( capture ) })](${ imageLink( capture.path ) })`
						)
					);
				}
				context.onProgress( `Screenshot captured (${ captureLabel })` );
				return {
					content: [
						{
							type: 'text' as const,
							text: textLines.join( '\n' ),
						},
						...( visionEnabled
							? captures.map( ( capture ) => ( {
									type: 'image' as const,
									data: ( capture.modelImage?.buffer ?? capture.buffer ).toString( 'base64' ),
									mimeType: capture.mimeType,
							  } ) )
							: [] ),
					],
					...( display
						? { studioArtifacts: captures.map( ( capture ) => capture.mediaWidgetPayload ) }
						: {} ),
				};
			} catch ( error ) {
				throw new Error(
					`Screenshot failed: ${ error instanceof Error ? error.message : String( error ) }`
				);
			}
		},
		{
			settlesPendingWork: true,
			annotations: LOCAL_CHANGE,
			forHost: ( options, host ): StudioToolDefinition | undefined =>
				createTakeScreenshotTool( {
					visionEnabled: options.visionEnabled !== false,
					imageLink: options.imageLink,
					// An app showing the conversation shows the captures as artifacts.
					userSeesCaptures: Boolean( host.ui ) || Boolean( options.imageLink ),
				} ),
		}
	);
}

export const takeScreenshotTool = createTakeScreenshotTool( { visionEnabled: true } );
