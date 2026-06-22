import { describe, expect, it } from 'vitest';
import {
	STALE_IMAGE_PLACEHOLDER_TEXT,
	stripStaleImagesFromContext,
} from '../runtimes/pi/strip-stale-images';
import type { Context, ImageContent, TextContent } from '@earendil-works/pi-ai';

function imageBlock( label = 'pixels' ): ImageContent {
	return { type: 'image', data: Buffer.from( label ).toString( 'base64' ), mimeType: 'image/jpeg' };
}

function textBlock( text: string ): TextContent {
	return { type: 'text', text };
}

function context( messages: Context[ 'messages' ] ): Context {
	return { messages };
}

describe( 'stripStaleImagesFromContext', () => {
	it( 'leaves the context untouched when at most one message carries images', () => {
		const onlyScreenshot = context( [
			{
				role: 'toolResult',
				toolCallId: 'tool-1',
				toolName: 'take_screenshot',
				content: [ textBlock( 'Screenshot captured' ), imageBlock( 'desktop' ) ],
				isError: false,
				timestamp: 1,
			},
		] );
		expect( stripStaleImagesFromContext( onlyScreenshot ) ).toBe( onlyScreenshot );

		const noImages = context( [
			{ role: 'user', content: [ textBlock( 'hello' ) ], timestamp: 1 },
		] );
		expect( stripStaleImagesFromContext( noImages ) ).toBe( noImages );
	} );

	it( 'replaces image blocks in older messages with a placeholder and keeps the latest images', () => {
		const ctx = context( [
			{
				role: 'toolResult',
				toolCallId: 'tool-1',
				toolName: 'take_screenshot',
				content: [ textBlock( 'First' ), imageBlock( 'old' ) ],
				isError: false,
				timestamp: 1,
			},
			{
				role: 'toolResult',
				toolCallId: 'tool-2',
				toolName: 'take_screenshot',
				content: [ textBlock( 'Second' ), imageBlock( 'new' ) ],
				isError: false,
				timestamp: 2,
			},
		] );

		const result = stripStaleImagesFromContext( ctx );
		expect( ( result.messages[ 0 ] as { content: unknown[] } ).content ).toEqual( [
			textBlock( 'First' ),
			textBlock( STALE_IMAGE_PLACEHOLDER_TEXT ),
		] );
		expect( result.messages[ 1 ] ).toBe( ctx.messages[ 1 ] );
	} );
} );
