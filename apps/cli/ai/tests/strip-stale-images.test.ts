import { describe, expect, it } from 'vitest';
import {
	IMAGE_HISTORY_LIMITS,
	STALE_IMAGE_PLACEHOLDER_TEXT,
	stripStaleImagesFromContext,
} from '../runtimes/pi/strip-stale-images';
import type { Context, ImageContent, Message, TextContent } from '@earendil-works/pi-ai';

function imageBlock( label = 'pixels', bytes = label.length ): ImageContent {
	return {
		type: 'image',
		data: Buffer.from( label.padEnd( bytes, '.' ) ).toString( 'base64' ),
		mimeType: 'image/jpeg',
	};
}

function textBlock( text: string ): TextContent {
	return { type: 'text', text };
}

function screenshotResult( id: string, ...images: ImageContent[] ): Message {
	return {
		role: 'toolResult',
		toolCallId: id,
		toolName: 'take_screenshot',
		content: [ textBlock( `Screenshot ${ id }` ), ...images ],
		isError: false,
		timestamp: Number( id.replace( /\D/g, '' ) ),
	};
}

function context( messages: Context[ 'messages' ] ): Context {
	return { messages };
}

const contentOf = ( message: Message ) => ( message as { content: unknown[] } ).content;

describe( 'stripStaleImagesFromContext', () => {
	it( 'returns the same context while the image history fits the limits', () => {
		const ctx = context( [
			screenshotResult( 'tool-1', imageBlock( 'first' ) ),
			{
				role: 'user',
				content: [ textBlock( 'looks off' ), imageBlock( 'attached' ) ],
				timestamp: 2,
			},
			screenshotResult( 'tool-3', imageBlock( 'desktop' ), imageBlock( 'mobile' ) ),
		] );
		expect( stripStaleImagesFromContext( ctx ) ).toBe( ctx );

		const noImages = context( [
			{ role: 'user', content: [ textBlock( 'hello' ) ], timestamp: 1 },
		] );
		expect( stripStaleImagesFromContext( noImages ) ).toBe( noImages );
	} );

	it( 'drops the oldest images first once the byte budget is exceeded', () => {
		const ctx = context( [
			screenshotResult( 'tool-1', imageBlock( 'first', 100 ) ),
			screenshotResult( 'tool-2', imageBlock( 'second', 100 ) ),
			screenshotResult( 'tool-3', imageBlock( 'third', 100 ) ),
		] );
		const twoImages = Buffer.from( 'x'.repeat( 100 ) ).toString( 'base64' ).length * 2;

		const result = stripStaleImagesFromContext( ctx, { maxImages: 20, maxBytes: twoImages } );
		expect( contentOf( result.messages[ 0 ] ) ).toEqual( [
			textBlock( 'Screenshot tool-1' ),
			textBlock( STALE_IMAGE_PLACEHOLDER_TEXT ),
		] );
		expect( result.messages[ 1 ] ).toBe( ctx.messages[ 1 ] );
		expect( result.messages[ 2 ] ).toBe( ctx.messages[ 2 ] );
	} );

	it( 'caps the number of images kept, counting from the newest', () => {
		const ctx = context( [
			screenshotResult( 'tool-1', imageBlock( 'a' ), imageBlock( 'b' ) ),
			screenshotResult( 'tool-2', imageBlock( 'c' ), imageBlock( 'd' ) ),
			screenshotResult( 'tool-3', imageBlock( 'e' ) ),
		] );

		const result = stripStaleImagesFromContext( ctx, { maxImages: 3, maxBytes: Infinity } );
		expect( contentOf( result.messages[ 0 ] ) ).toEqual( [
			textBlock( 'Screenshot tool-1' ),
			textBlock( STALE_IMAGE_PLACEHOLDER_TEXT ),
			textBlock( STALE_IMAGE_PLACEHOLDER_TEXT ),
		] );
		expect( result.messages[ 1 ] ).toBe( ctx.messages[ 1 ] );
		expect( result.messages[ 2 ] ).toBe( ctx.messages[ 2 ] );
	} );

	it( 'always keeps the newest image-bearing message, even one over budget on its own', () => {
		const ctx = context( [
			screenshotResult( 'tool-1', imageBlock( 'old', 50 ) ),
			screenshotResult( 'tool-2', imageBlock( 'desktop', 500 ), imageBlock( 'mobile', 500 ) ),
			{ role: 'user', content: [ textBlock( 'and then?' ) ], timestamp: 3 },
		] );

		const result = stripStaleImagesFromContext( ctx, { maxImages: 1, maxBytes: 10 } );
		expect( contentOf( result.messages[ 0 ] ) ).toEqual( [
			textBlock( 'Screenshot tool-1' ),
			textBlock( STALE_IMAGE_PLACEHOLDER_TEXT ),
		] );
		expect( result.messages[ 1 ] ).toBe( ctx.messages[ 1 ] );
		expect( result.messages[ 2 ] ).toBe( ctx.messages[ 2 ] );
	} );

	it( 'keeps a stable suffix so a message that lost its images never gets them back', () => {
		const limits = { maxImages: 2, maxBytes: Infinity };
		const history = [
			screenshotResult( 'tool-1', imageBlock( 'a' ) ),
			screenshotResult( 'tool-2', imageBlock( 'b' ) ),
			screenshotResult( 'tool-3', imageBlock( 'c' ) ),
			screenshotResult( 'tool-4', imageBlock( 'd' ) ),
		];
		const strippedAt = ( length: number ) =>
			stripStaleImagesFromContext( context( history.slice( 0, length ) ), limits ).messages.map(
				( message, index ) => message !== history[ index ]
			);

		expect( strippedAt( 2 ) ).toEqual( [ false, false ] );
		expect( strippedAt( 3 ) ).toEqual( [ true, false, false ] );
		expect( strippedAt( 4 ) ).toEqual( [ true, true, false, false ] );
	} );

	it( 'defaults to limits that keep a full build of captures in history', () => {
		// Ten `viewport: "all"` captures at the fitted size (~150KB of base64
		// per viewport pair) stay in history untouched.
		const ctx = context(
			Array.from( { length: 10 }, ( _, index ) =>
				screenshotResult(
					`tool-${ index + 1 }`,
					imageBlock( 'desktop', 90 * 1024 ),
					imageBlock( 'mobile', 20 * 1024 )
				)
			)
		);
		expect( IMAGE_HISTORY_LIMITS.maxImages ).toBe( 20 );
		expect( stripStaleImagesFromContext( ctx ) ).toBe( ctx );
	} );
} );
