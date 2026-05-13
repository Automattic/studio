import { Type } from 'typebox';
import { emitProgress } from 'cli/logger';
import { defineTool } from './define-tool';
import {
	captureScreenshotPngBuffer,
	saveScreenshotPngToTempFile,
	VIEWPORTS,
} from './screenshot-helpers';

export const takeScreenshotTool = defineTool(
	'take_screenshot',
	'Takes a full-page screenshot of a URL. Returns the screenshot as an image that you can analyze visually. ' +
		'Also saves the screenshot as a temporary local PNG and returns a ready-to-use media widget payload. ' +
		'Supports desktop and mobile viewports. Use this to verify the site looks correct after building it. ' +
		'Use `share_screenshot` instead only in remote sessions where you need to deliver the rendered page outside the Studio UI.',
	{
		url: Type.String( { description: 'The URL to screenshot' } ),
		viewport: Type.Optional(
			Type.Enum( [ 'desktop', 'mobile' ], {
				description:
					'Viewport size: "desktop" (1040x1248) or "mobile" (390x844). Defaults to desktop.',
			} )
		),
	},
	async ( args ) => {
		try {
			const viewportType = args.viewport ?? 'desktop';
			emitProgress( `Taking ${ viewportType } screenshot of ${ args.url }…` );
			const buffer = await captureScreenshotPngBuffer( args.url, VIEWPORTS[ viewportType ], {
				fullPage: true,
			} );
			const screenshotFile = await saveScreenshotPngToTempFile( buffer, { viewportType } );
			const mediaWidgetPayload = {
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
			};
			emitProgress( `Screenshot captured (${ viewportType })` );
			return {
				content: [
					{
						type: 'text' as const,
						text: [
							`Screenshot captured (${ viewportType }).`,
							`mediaWidgetPayload=${ JSON.stringify( mediaWidgetPayload ) }`,
						].join( '\n' ),
					},
					{
						type: 'image' as const,
						data: buffer.toString( 'base64' ),
						mimeType: 'image/png',
					},
				],
			};
		} catch ( error ) {
			throw new Error(
				`Screenshot failed: ${ error instanceof Error ? error.message : String( error ) }`
			);
		}
	}
);
