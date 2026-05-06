import { Type } from 'typebox';
import { emitProgress } from 'cli/logger';
import { defineTool } from './define-tool';
import { captureScreenshotPng, VIEWPORTS } from './screenshot-helpers';

export const takeScreenshotTool = defineTool(
	'take_screenshot',
	'Takes a full-page screenshot of a URL. Returns the screenshot as an image that you can analyze visually. ' +
		'Supports desktop and mobile viewports. Use this to verify the site looks correct after building it. ' +
		'Note: this image is for your own visual reasoning only — the user does not see it. ' +
		'Use `share_screenshot` instead when you want to deliver the rendered page to the user.',
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
			const base64 = await captureScreenshotPng( args.url, VIEWPORTS[ viewportType ], {
				fullPage: true,
			} );
			emitProgress( `Screenshot captured (${ viewportType })` );
			return {
				content: [
					{
						type: 'image' as const,
						data: base64,
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
