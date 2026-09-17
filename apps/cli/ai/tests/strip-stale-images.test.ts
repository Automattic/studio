import { describe, expect, it } from 'vitest';
import {
	STALE_IMAGE_PLACEHOLDER_TEXT,
	stripStaleImagesFromContext,
} from '../runtimes/pi/strip-stale-images';
import type { Context, Message } from '@earendil-works/pi-ai';

// A screenshot result whose one image takes `bytes` base64 characters.
function screenshot( id: number, bytes = 4 ): Message {
	return {
		role: 'toolResult',
		toolCallId: `tool-${ id }`,
		toolName: 'take_screenshot',
		content: [
			{ type: 'text', text: `Screenshot ${ id }` },
			{ type: 'image', data: 'x'.repeat( bytes ), mimeType: 'image/jpeg' },
		],
		isError: false,
		timestamp: id,
	};
}

const context = ( messages: Message[] ): Context => ( { messages } );
const strippedIndexes = ( before: Context, after: Context ) =>
	after.messages.flatMap( ( message, index ) =>
		message === before.messages[ index ] ? [] : index
	);

describe( 'stripStaleImagesFromContext', () => {
	it( 'keeps every image while the history fits the budget', () => {
		const ctx = context( [ screenshot( 1 ), screenshot( 2 ), screenshot( 3 ) ] );
		expect( stripStaleImagesFromContext( ctx, 12 ) ).toBe( ctx );

		const noImages = context( [ { role: 'user', content: 'hello', timestamp: 1 } ] );
		expect( stripStaleImagesFromContext( noImages, 0 ) ).toBe( noImages );
	} );

	it( 'replaces the oldest images with a placeholder once the budget is exceeded', () => {
		const ctx = context( [ screenshot( 1 ), screenshot( 2 ), screenshot( 3 ) ] );

		const result = stripStaleImagesFromContext( ctx, 8 );

		expect( strippedIndexes( ctx, result ) ).toEqual( [ 0 ] );
		expect( ( result.messages[ 0 ] as { content: unknown[] } ).content ).toEqual( [
			{ type: 'text', text: 'Screenshot 1' },
			{ type: 'text', text: STALE_IMAGE_PLACEHOLDER_TEXT },
		] );
	} );

	it( 'always keeps the newest images, even over budget', () => {
		const ctx = context( [ screenshot( 1 ), screenshot( 2, 100 ) ] );
		expect( strippedIndexes( ctx, stripStaleImagesFromContext( ctx, 10 ) ) ).toEqual( [ 0 ] );
	} );

	// Stripping a message that kept its images on the previous request, or
	// restoring one, would change the cached prefix.
	it( 'never restores images to a message as the history grows', () => {
		const history = [ screenshot( 1 ), screenshot( 2 ), screenshot( 3 ), screenshot( 4 ) ];
		const strippedAt = ( length: number ) => {
			const ctx = context( history.slice( 0, length ) );
			return strippedIndexes( ctx, stripStaleImagesFromContext( ctx, 8 ) );
		};

		expect( strippedAt( 2 ) ).toEqual( [] );
		expect( strippedAt( 3 ) ).toEqual( [ 0 ] );
		expect( strippedAt( 4 ) ).toEqual( [ 0, 1 ] );
	} );
} );
