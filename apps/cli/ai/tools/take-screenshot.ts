import { Type } from 'typebox';
import { emitProgress } from 'cli/logger';
import { defineTool } from './define-tool';
import {
	captureScreenshotPngBuffer,
	saveScreenshotPngToTempFile,
	VIEWPORTS,
} from './screenshot-helpers';

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
		'Also saves the screenshot as a temporary local PNG and returns a ready-to-use media widget payload. ' +
		'Supports desktop and mobile viewports; pass `viewport: "all"` when you need both for design verification. ' +
		'Use this to verify the site looks correct after building it. ' +
		'Use `share_screenshot` instead only in remote sessions where you need to deliver the rendered page outside the Studio UI.',
	{
		url: Type.String( { description: 'The URL to screenshot' } ),
		viewport: Type.Optional( screenshotViewportSchema ),
	},
	async ( args ) => {
		try {
			const viewportTypes = resolveViewportTypes( args.viewport );
			const viewportLabel = getViewportLabel( viewportTypes );
			emitProgress( `Taking ${ viewportLabel } screenshot of ${ args.url }…` );
			const captures = await Promise.all(
				viewportTypes.map( async ( viewportType ) => {
					const buffer = await captureScreenshotPngBuffer( args.url, VIEWPORTS[ viewportType ], {
						fullPage: true,
					} );
					const screenshotFile = await saveScreenshotPngToTempFile( buffer, { viewportType } );
					return {
						viewportType,
						buffer,
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
			const textLines =
				captures.length === 1
					? [
							`Screenshot captured (${ captures[ 0 ].viewportType }).`,
							`mediaWidgetPayload=${ JSON.stringify( captures[ 0 ].mediaWidgetPayload ) }`,
					  ]
					: [
							`Screenshots captured (${ captures
								.map( ( capture ) => capture.viewportType )
								.join( ', ' ) }).`,
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
						mimeType: 'image/png',
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
