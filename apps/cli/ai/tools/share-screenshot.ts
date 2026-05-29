import { Type } from 'typebox';
import { emitEvent } from 'cli/ai/json-events';
import { defineTool } from './define-tool';
import {
	captureScreenshotPng,
	SHARE_DEVICE_SCALE_FACTOR,
	SHARE_VIEWPORTS,
} from './screenshot-helpers';
import { textResult } from './utils';

/**
 * Fire-and-forget delivery of a screenshot to the user via the
 * remote-session bridge (Telegram). Distinct from `take_screenshot`, which
 * returns the image to the agent for its own visual reasoning. Here the
 * agent never sees the image — the user does, and the agent gets only a
 * confirmation string back.
 *
 * Only registered when the agent is actually being driven by the
 * remote-session daemon (`STUDIO_REMOTE_SESSION=1`); the regular desktop /
 * interactive CLI flows don't expose this tool.
 */
export const shareScreenshotTool = defineTool(
	'share_screenshot',
	'Fire-and-forget primitive that captures a URL and delivers the image to the user. ' +
		'Use this when the user explicitly asks to see the site, or when you finish a logical milestone with a clear visible result worth looking at — not after every intermediate edit. ' +
		'One screenshot per milestone, not per tool call. If the change is non-visual (data, listings, logs), skip the screenshot and reply in text. ' +
		'Returns a confirmation string only — the image is NOT returned to you. ' +
		'The user already has the picture; do not analyze or describe what was sent in your reply. ' +
		'After calling this, write at most one short follow-up sentence and end the turn. ' +
		'Defaults to a 16:9 above-the-fold view. Set `fullPage: true` only when the user explicitly asks for the whole scroll length. ' +
		'Distinct from `take_screenshot`, which is for your own visual reasoning before continuing work.',
	{
		url: Type.String( { description: 'The URL to screenshot and send to the user' } ),
		viewport: Type.Optional(
			Type.Enum( [ 'desktop', 'mobile' ], {
				description:
					'Viewport size: "desktop" (1280x720, 16:9) or "mobile" (390x844). Defaults to desktop.',
			} )
		),
		fullPage: Type.Optional(
			Type.Boolean( {
				description:
					'When true, capture the entire scrolled page instead of just the viewport. Defaults to false; only set this when the user has explicitly asked for the full page.',
			} )
		),
		caption: Type.Optional(
			Type.String( {
				description:
					'Short caption sent with the image. Describe what the user is looking at; do NOT mention "full page", "viewport", or other capture-mode wording. Keep it under ~1024 characters.',
			} )
		),
	},
	async ( args ) => {
		try {
			const viewportType = args.viewport ?? 'desktop';
			const base64 = await captureScreenshotPng( args.url, SHARE_VIEWPORTS[ viewportType ], {
				fullPage: args.fullPage ?? false,
				deviceScaleFactor: SHARE_DEVICE_SCALE_FACTOR,
			} );

			emitEvent( {
				type: 'media.share',
				timestamp: new Date().toISOString(),
				mediaType: 'image',
				mimeType: 'image/png',
				dataBase64: base64,
				caption: args.caption,
			} );

			return textResult(
				`Screenshot delivered to the user (${ viewportType }${
					args.fullPage ? ', full page' : ''
				}). The user is viewing it now; do not describe what was sent.`
			);
		} catch ( error ) {
			throw new Error(
				`Share screenshot failed: ${ error instanceof Error ? error.message : String( error ) }`
			);
		}
	}
);
