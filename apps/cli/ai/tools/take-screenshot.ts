import { Type } from 'typebox';
import { emitProgress } from 'cli/logger';
import { defineTool } from './define-tool';
import { captureScreenshotBuffer, saveScreenshotToTempFile, VIEWPORTS } from './screenshot-helpers';

const screenshotViewportSchema = Type.Enum( [ 'desktop', 'mobile', 'all' ], {
	description:
		'Viewport size: "desktop" (1040x1248), "mobile" (390x844), or "all" to capture both in one tool call. Defaults to desktop.',
} );
type ScreenshotViewportArgument = 'desktop' | 'mobile' | 'all';
type ScreenshotViewportType = keyof typeof VIEWPORTS;

function resolveViewportTypes( viewport?: ScreenshotViewportArgument ): ScreenshotViewportType[] {
	if ( viewport === 'all' ) {
		return [ 'desktop', 'mobile' ];
	}
	return [ viewport ?? 'desktop' ];
}

function getViewportLabel( viewportTypes: ScreenshotViewportType[] ): string {
	return viewportTypes.length === 1 ? viewportTypes[ 0 ] : viewportTypes.join( ' and ' );
}

export const takeScreenshotTool = defineTool(
	'take_screenshot',
	'Takes a full-page screenshot of a URL. Returns the screenshot as an image that you can analyze visually. ' +
		'Also saves the screenshot as a temporary local image and returns a ready-to-use media widget payload. ' +
		'Supports desktop and mobile viewports; pass `viewport: "all"` when you need both for design verification. ' +
		'Long pages are clipped at 8000 vertical pixels (a vision-model limit); the response reports the document height and whether more remains, and you can call again with `offset` to fetch the next slice. ' +
		'Use this to verify the site looks correct after building it. ' +
		'Use `share_screenshot` instead only in remote sessions where you need to deliver the rendered page outside the Studio UI.',
	{
		url: Type.String( { description: 'The URL to screenshot' } ),
		viewport: Type.Optional( screenshotViewportSchema ),
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
			const viewportLabel = getViewportLabel( viewportTypes );
			emitProgress( `Taking ${ viewportLabel } screenshot of ${ args.url }…` );
			const captures = await Promise.all(
				viewportTypes.map( async ( viewportType ) => {
					const capture = await captureScreenshotBuffer( args.url, VIEWPORTS[ viewportType ], {
						fullPage: true,
						format: 'jpeg',
						offset: args.offset,
					} );
					const screenshotFile = await saveScreenshotToTempFile( capture.buffer, {
						viewportType,
						format: 'jpeg',
					} );
					return {
						viewportType,
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
								alt: `Screenshot of ${ args.url } (${ viewportType })`,
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
				if ( capture.clipped ) {
					return `${ capture.viewportType }: captured rows ${ capture.offset }-${ captureEnd } of a ${ capture.documentHeight }px page. Page was clipped; call again with offset:${ captureEnd } to fetch the next slice.`;
				}
				if ( capture.offset > 0 ) {
					return `${ capture.viewportType }: captured rows ${ capture.offset }-${ captureEnd } of a ${ capture.documentHeight }px page (end of page).`;
				}
				return `${ capture.viewportType }: captured full page (${ capture.documentHeight }px tall).`;
			};
			const captureLines = captures.map( describeCapture );
			const textLines =
				captures.length === 1
					? [
							`Screenshot captured — ${ captureLines[ 0 ] }`,
							`mediaWidgetPayload=${ JSON.stringify( captures[ 0 ].mediaWidgetPayload ) }`,
					  ]
					: [
							'Screenshots captured:',
							...captureLines.map( ( line ) => `- ${ line }` ),
							`mediaWidgetPayloads=${ JSON.stringify(
								captures.map( ( capture ) => capture.mediaWidgetPayload )
							) }`,
					  ];
			emitProgress( `Screenshot captured (${ viewportLabel })` );
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
			};
		} catch ( error ) {
			throw new Error(
				`Screenshot failed: ${ error instanceof Error ? error.message : String( error ) }`
			);
		}
	}
);
