import { Type } from 'typebox';
import { emitProgress } from 'cli/logger';
import { defineTool } from './define-tool';
import {
	captureScreenshotBuffer,
	saveScreenshotFile,
	SCREENSHOT_COLOR_SCHEME_DESCRIPTION,
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
	description: SCREENSHOT_COLOR_SCHEME_DESCRIPTION.replace(
		'"light" or "dark"',
		'"light", "dark", or "all" to capture both'
	),
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
		return [ 'light', 'dark' ];
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

export const takeScreenshotTool = defineTool(
	'take_screenshot',
	'Takes a full-page screenshot of a URL. Returns the screenshot as an image that you can analyze visually. ' +
		'Supports desktop and mobile viewports; pass `viewport: "all"` when you need both for design verification. ' +
		'Pass `colorScheme: "light"`, `colorScheme: "dark"`, or `colorScheme: "all"` to verify pages that respond to prefers-color-scheme. ' +
		'Long pages are clipped at 8000 vertical pixels (a vision-model limit); the response reports the document height and whether more remains, and you can call again with `offset` to fetch the next slice. ' +
		'Use this to verify the site looks correct after building it. ' +
		'Use `share_screenshot` instead only in remote sessions where you need to deliver the rendered page outside the Studio UI.',
	{
		url: Type.String( { description: 'The URL to screenshot' } ),
		viewport: Type.Optional( screenshotViewportSchema ),
		colorScheme: Type.Optional( screenshotColorSchemeSchema ),
		offset: Type.Optional(
			Type.Number( {
				minimum: 0,
				description:
					'Y-offset in CSS pixels for the capture region. Defaults to 0 (top of page). When a previous call reports the page was clipped, pass `offset` equal to where that capture ended to fetch the next slice.',
			} )
		),
	},
	async ( args ) => {
		try {
			const viewportTypes = resolveViewportTypes( args.viewport );
			const colorSchemes = resolveColorSchemes( args.colorScheme );
			const captureTargets = viewportTypes.flatMap( ( viewportType ) =>
				colorSchemes.map( ( colorScheme ) => ( { viewportType, colorScheme } ) )
			);
			const captureLabel = getCaptureListLabel( captureTargets );
			emitProgress( `Taking ${ captureLabel } screenshot of ${ args.url }…` );
			const captures = await Promise.all(
				captureTargets.map( async ( { viewportType, colorScheme } ) => {
					const capture = await captureScreenshotBuffer( args.url, VIEWPORTS[ viewportType ], {
						fullPage: true,
						format: 'jpeg',
						offset: args.offset,
						colorScheme,
					} );
					const screenshotFile = await saveScreenshotFile( capture.buffer, {
						viewportType,
						format: 'jpeg',
						colorScheme,
					} );
					return {
						viewportType,
						colorScheme,
						buffer: capture.buffer,
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
				if ( capture.clipped ) {
					return `${ label }: captured rows ${ capture.offset }-${ captureEnd } of a ${ capture.documentHeight }px page. Page was clipped; call again with offset:${ captureEnd } to fetch the next slice.`;
				}
				if ( capture.offset > 0 ) {
					return `${ label }: captured rows ${ capture.offset }-${ captureEnd } of a ${ capture.documentHeight }px page (end of page).`;
				}
				return `${ label }: captured full page (${ capture.documentHeight }px tall).`;
			};
			const captureLines = captures.map( describeCapture );
			const textLines =
				captures.length === 1
					? [ `Screenshot captured — ${ captureLines[ 0 ] }` ]
					: [ 'Screenshots captured:', ...captureLines.map( ( line ) => `- ${ line }` ) ];
			emitProgress( `Screenshot captured (${ captureLabel })` );
			return {
				content: [
					{
						type: 'text' as const,
						text: textLines.join( '\n' ),
					},
					...captures.map( ( capture ) => ( {
						type: 'image' as const,
						data: capture.buffer.toString( 'base64' ),
						mimeType: capture.mimeType,
					} ) ),
				],
				studioArtifacts: captures.map( ( capture ) => capture.mediaWidgetPayload ),
			};
		} catch ( error ) {
			throw new Error(
				`Screenshot failed: ${ error instanceof Error ? error.message : String( error ) }`
			);
		}
	}
);
