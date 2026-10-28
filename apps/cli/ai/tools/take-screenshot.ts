import { Type } from 'typebox';
import { defineTool, LOCAL_CHANGE } from './define-tool';
import {
	captureScreenshotBuffer,
	saveScreenshotFile,
	SCREENSHOT_COLOR_SCHEME_VALUES,
	VIEWPORTS,
	type ScreenshotColorScheme,
} from './screenshot-helpers';
import type { AnyStudioAgentTool } from './define-tool';

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
			'Supports desktop and mobile viewports; pass `viewport: "all"` for both. ' +
			'Pass `colorScheme: "light"`, `colorScheme: "dark"`, or `colorScheme: "all"` for pages that respond to prefers-color-scheme. ' +
			'Full-page captures of long pages are clipped at 8000 vertical pixels; the response reports the document height and whether more remains, and you can call again with `offset` to fetch the next slice. ' +
			'The user sees the site itself, in Studio or their browser, so a capture is yours alone; ' +
			( imageLink
				? 'pass `display: true` for one to show the user, which comes back with image lines to put in your reply.'
				: 'pass `display: true` to show one to the user in the chat as well.' ),
		{
			url: Type.String( { description: 'The URL to screenshot' } ),
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
				const viewportTypes = resolveViewportTypes( args.viewport );
				const colorSchemes = resolveColorSchemes( args.colorScheme );
				const captureTargets = viewportTypes.flatMap( ( viewportType ) =>
					colorSchemes.map( ( colorScheme ) => ( { viewportType, colorScheme } ) )
				);
				const captureLabel = getCaptureListLabel( captureTargets );
				const fullPage = args.fullPage === true || args.offset !== undefined;
				const display = args.display === true;
				context.onProgress( `Taking ${ captureLabel } screenshot of ${ args.url }…` );
				const captures = await Promise.all(
					captureTargets.map( async ( { viewportType, colorScheme } ) => {
						const capture = await captureScreenshotBuffer( args.url, VIEWPORTS[ viewportType ], {
							fullPage,
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
			forHost: ( host ): AnyStudioAgentTool | undefined =>
				createTakeScreenshotTool( {
					visionEnabled: host.visionEnabled !== false,
					imageLink: host.imageLink,
					userSeesCaptures: host.emitChatArtifacts === true || Boolean( host.imageLink ),
				} ),
		}
	);
}

export const takeScreenshotTool = createTakeScreenshotTool( { visionEnabled: true } );
