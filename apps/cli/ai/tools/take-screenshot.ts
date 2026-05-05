import { tool } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod/v4';
import { emitProgress } from 'cli/logger';
import { captureScreenshotPng, VIEWPORTS } from './screenshot-helpers';
import { errorResult } from './utils';

export const takeScreenshotTool = tool(
	'take_screenshot',
	'Takes a full-page screenshot of a URL. Returns the screenshot as an image that you can analyze visually. ' +
		'Supports desktop and mobile viewports. Use this to verify the site looks correct after building it. ' +
		'Note: this image is for your own visual reasoning only — the user does not see it. ' +
		'Use `share_screenshot` instead when you want to deliver the rendered page to the user.',
	{
		url: z.string().describe( 'The URL to screenshot' ),
		viewport: z
			.enum( [ 'desktop', 'mobile' ] )
			.optional()
			.describe(
				'Viewport size: "desktop" (1040x1248) or "mobile" (390x844). Defaults to desktop.'
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
			return errorResult(
				`Screenshot failed: ${ error instanceof Error ? error.message : String( error ) }`
			);
		}
	}
);
