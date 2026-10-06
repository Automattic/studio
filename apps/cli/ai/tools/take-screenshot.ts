import { copyFile } from 'node:fs/promises';
import path from 'node:path';
import { Type } from 'typebox';
import { STUDIO_SITES_ROOT } from 'cli/lib/site-paths';
import { defineTool } from './define-tool';
import {
	captureScreenshotBuffer,
	saveScreenshotFile,
	SCREENSHOT_COLOR_SCHEME_VALUES,
	VIEWPORTS,
	type ScreenshotColorScheme,
} from './screenshot-helpers';

const screenshotViewportSchema = Type.Enum( [ 'desktop', 'mobile', 'all' ], {
	description:
		'Viewport size: "desktop" (1040x1248), "mobile" (390x844), or "all" to capture both in one tool call. Defaults to desktop.',
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
	return [ viewport ?? 'desktop' ];
}

function resolveColorSchemes(
	colorScheme?: ScreenshotColorSchemeArgument
): Array< ScreenshotColorScheme | undefined > {
	if ( colorScheme === 'all' ) {
		return [ ...SCREENSHOT_COLOR_SCHEME_VALUES ];
	}
	return [ colorScheme ];
}

function getCaptureLabel( target: {
	viewportType: ScreenshotViewportType;
	colorScheme?: ScreenshotColorScheme;
} ): string {
	return target.colorScheme
		? `${ target.viewportType } ${ target.colorScheme }`
		: target.viewportType;
}

function getCaptureListLabel(
	targets: Array< { viewportType: ScreenshotViewportType; colorScheme?: ScreenshotColorScheme } >
): string {
	return targets.map( getCaptureLabel ).join( ', ' );
}

const TEXT_ONLY_NOTE =
	'This model cannot view images, so the capture is not shown to you: verify the rendered page with inspect_design.';

// Text-only models still get the tool (it sets the theme screenshot) but no
// image block, which they would otherwise describe without seeing.
export function createTakeScreenshotTool( {
	visionEnabled,
	imageLink,
}: {
	visionEnabled: boolean;
	imageLink?: ( file: string ) => string;
} ) {
	return defineTool(
		'take_screenshot',
		'Takes a full-page screenshot of a URL. ' +
			( visionEnabled
				? 'Returns the screenshot as an image that you can analyze visually; tall pages are scaled down to 2000 pixels on their longest side, and the saved file keeps full resolution. '
				: `${ TEXT_ONLY_NOTE } ` ) +
			'Supports desktop and mobile viewports; pass `viewport: "all"` when you need both for design verification. ' +
			'Pass `colorScheme: "light"`, `colorScheme: "dark"`, or `colorScheme: "all"` to verify pages that respond to prefers-color-scheme. ' +
			'Long pages are clipped at 8000 vertical pixels; the response reports the document height and whether more remains, and you can call again with `offset` to fetch the next slice. ' +
			'Use this to verify the site looks correct after building it. ' +
			( imageLink
				? 'Captures meant for the user come back with image lines to put in your reply, which show them; '
				: 'Captures are shown to the user in the chat by default; ' ) +
			'pass `display: false` for internal verification captures while iterating so the user only sees deliberate milestones.',
		{
			url: Type.String( { description: 'The URL to screenshot' } ),
			viewport: Type.Optional( screenshotViewportSchema ),
			colorScheme: Type.Optional( screenshotColorSchemeSchema ),
			display: Type.Optional(
				Type.Boolean( {
					description:
						'Whether to show the capture to the user in the chat. Defaults to true; set false for internal verification captures the user does not need to see.',
				} )
			),
			offset: Type.Optional(
				Type.Number( {
					minimum: 0,
					description:
						'Y-offset in CSS pixels for the capture region. Defaults to 0 (top of page). When a previous call reports the page was clipped, pass `offset` equal to where that capture ended to fetch the next slice.',
				} )
			),
			themeScreenshot: Type.Optional(
				Type.String( {
					description:
						"The absolute path of a theme's directory in a Studio site (`<site path>/wp-content/themes/<slug>`): also saves the desktop capture there as screenshot.jpg, the theme's thumbnail in Appearance → Themes.",
				} )
			),
		},
		async ( args, context ) => {
			try {
				const themeDirectory = args.themeScreenshot && path.resolve( args.themeScreenshot );
				if ( themeDirectory && ! themeDirectory.startsWith( STUDIO_SITES_ROOT + path.sep ) ) {
					throw new Error(
						`themeScreenshot must be the absolute path of a theme directory in a Studio site (${ STUDIO_SITES_ROOT }/<site>/wp-content/themes/<slug>).`
					);
				}
				const viewportTypes = resolveViewportTypes( args.viewport );
				if ( themeDirectory && ! viewportTypes.includes( 'desktop' ) ) {
					throw new Error( 'themeScreenshot needs a desktop capture.' );
				}
				const colorSchemes = resolveColorSchemes( args.colorScheme );
				const captureTargets = viewportTypes.flatMap( ( viewportType ) =>
					colorSchemes.map( ( colorScheme ) => ( { viewportType, colorScheme } ) )
				);
				const captureLabel = getCaptureListLabel( captureTargets );
				context.onProgress( `Taking ${ captureLabel } screenshot of ${ args.url }…` );
				const captures = await Promise.all(
					captureTargets.map( async ( { viewportType, colorScheme } ) => {
						const capture = await captureScreenshotBuffer( args.url, VIEWPORTS[ viewportType ], {
							fullPage: true,
							format: 'jpeg',
							offset: args.offset,
							colorScheme,
							forModel: visionEnabled,
						} );
						const screenshotFile = await saveScreenshotFile( capture.buffer, {
							viewportType,
							format: 'jpeg',
							colorScheme,
						} );
						// Progress lines persist in the CLI transcript (but not in the
						// desktop conversation history, where the inline artifact is the
						// UI), so this is the terminal user's only handle on the file.
						context.onProgress(
							`Saved ${ getCaptureLabel( { viewportType, colorScheme } ) } screenshot to ${
								screenshotFile.fileUrl
							}`
						);
						return {
							viewportType,
							colorScheme,
							path: screenshotFile.path,
							buffer: capture.buffer,
							modelImage: capture.modelImage,
							documentHeight: capture.documentHeight,
							capturedHeight: capture.capturedHeight,
							offset: capture.offset,
							clipped: capture.clipped,
							mimeType: screenshotFile.mimeType,
							mediaWidgetPayload: {
								type: 'media',
								widgetProps: {
									url: screenshotFile.fileUrl,
									mediaKind: 'image',
									alt: `Screenshot of ${ args.url } (${ getCaptureLabel( {
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
					if ( capture.clipped ) {
						return `${ label }: captured rows ${ capture.offset }-${ captureEnd } of a ${ capture.documentHeight }px page${ shown }. Page was clipped; call again with offset:${ captureEnd } to fetch the next slice.`;
					}
					if ( capture.offset > 0 ) {
						return `${ label }: captured rows ${ capture.offset }-${ captureEnd } of a ${ capture.documentHeight }px page${ shown } (end of page).`;
					}
					return `${ label }: captured full page (${ capture.documentHeight }px tall${ shown }).`;
				};
				const captureLines = captures.map(
					( capture ) => `${ describeCapture( capture ) } Saved to ${ capture.path }`
				);
				const textLines =
					captures.length === 1
						? [ `Screenshot captured — ${ captureLines[ 0 ] }` ]
						: [ 'Screenshots captured:', ...captureLines.map( ( line ) => `- ${ line }` ) ];
				const desktop = captures.find( ( capture ) => capture.viewportType === 'desktop' );
				if ( themeDirectory && desktop ) {
					const themeScreenshot = path.join( themeDirectory, 'screenshot.jpg' );
					await copyFile( desktop.path, themeScreenshot );
					textLines.push(
						`Saved the desktop capture as the theme screenshot: ${ themeScreenshot }`
					);
				}
				if ( ! visionEnabled ) {
					textLines.push( TEXT_ONLY_NOTE );
				}
				if ( imageLink && args.display !== false ) {
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
					...( args.display === false
						? {}
						: { studioArtifacts: captures.map( ( capture ) => capture.mediaWidgetPayload ) } ),
				};
			} catch ( error ) {
				throw new Error(
					`Screenshot failed: ${ error instanceof Error ? error.message : String( error ) }`
				);
			}
		},
		{
			settlesPendingWork: true,
			promptSnippet: visionEnabled
				? 'Take a full-page screenshot of a URL (supports desktop, mobile, or `viewport: "all"` for both). Use this to visually check the site after building it.'
				: 'Save a full-page screenshot of a URL to a file (supports desktop, mobile, or `viewport: "all"` for both). You cannot view the image, but it still sets the theme screenshot.',
		}
	);
}

export const takeScreenshotTool = createTakeScreenshotTool( { visionEnabled: true } );
