/**
 * Hidden plumbing command: captures a full-page screenshot of a URL with the
 * same Playwright pipeline the agent's `take_screenshot` tool uses (lazy
 * image scrolling, font settling, admin-bar hiding, 8000px height cap) and
 * writes the JPEG to `--out`.
 *
 * The desktop app shells out to this for the preview's "Clip the page"
 * action — CDP full-page capture is unreliable for webview guests, while a
 * headless top-level page renders it correctly in one pass.
 */

import { writeFile } from 'node:fs/promises';
import { SiteCommandLoggerAction as LoggerAction } from '@studio/common/logger-actions';
import { __, sprintf } from '@wordpress/i18n';
import { closeSharedBrowser } from 'cli/ai/browser-utils';
import { captureScreenshotBuffer, VIEWPORTS } from 'cli/ai/tools/screenshot-helpers';
import { Logger, LoggerError } from 'cli/logger';
import { StudioArgv } from 'cli/types';

const logger = new Logger< LoggerAction >();

export async function runCommand( options: {
	url: string;
	out: string;
	width?: number;
	colorScheme?: 'light' | 'dark';
} ): Promise< void > {
	const width = options.width ?? VIEWPORTS.desktop.width;
	// The viewport height only shapes the lazy-load scroll steps; keep the
	// desktop aspect for arbitrary widths.
	const height = Math.round( ( width * VIEWPORTS.desktop.height ) / VIEWPORTS.desktop.width );
	try {
		const capture = await captureScreenshotBuffer(
			options.url,
			{ width, height },
			{
				fullPage: true,
				format: 'jpeg',
				colorScheme: options.colorScheme,
			}
		);
		await writeFile( options.out, capture.buffer );
		logger.reportSuccess(
			sprintf(
				/* translators: 1: page height in pixels, 2: output file path. */
				__( 'Captured %1$dpx page to %2$s' ),
				capture.documentHeight,
				options.out
			)
		);
	} finally {
		// One-shot process: release the shared Chromium so the event loop
		// can exit instead of hanging the caller.
		await closeSharedBrowser();
	}
}

export const registerCommand = ( yargs: StudioArgv ) => {
	return yargs.command( {
		command: 'screenshot <url>',
		// Hidden: internal plumbing for the desktop app's page clips.
		describe: false,
		builder: ( yargs ) => {
			return yargs
				.positional( 'url', {
					type: 'string',
					demandOption: true,
					describe: __( 'The URL to capture' ),
				} )
				.option( 'out', {
					type: 'string',
					demandOption: true,
					describe: __( 'File path to write the JPEG to' ),
				} )
				.option( 'width', {
					type: 'number',
					describe: __( 'Viewport width in CSS pixels' ),
				} )
				.option( 'color-scheme', {
					type: 'string',
					choices: [ 'light', 'dark' ] as const,
					describe: __( 'prefers-color-scheme to emulate' ),
				} );
		},
		handler: async ( argv ) => {
			try {
				await runCommand( {
					url: argv.url,
					out: argv.out,
					width: argv.width,
					colorScheme: argv[ 'color-scheme' ] as 'light' | 'dark' | undefined,
				} );
			} catch ( error ) {
				logger.reportError( new LoggerError( __( 'Failed to capture screenshot' ), error ) );
			}
		},
	} );
};
