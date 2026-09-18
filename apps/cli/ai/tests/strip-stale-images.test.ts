import { describe, expect, it } from 'vitest';
import {
	STALE_IMAGE_PLACEHOLDER_TEXT,
	stripStaleImagesFromContext,
} from '../runtimes/pi/strip-stale-images';
import type { Message } from '@earendil-works/pi-ai';

const screenshot = ( id: number, bytes: number ): Message => ( {
	role: 'toolResult',
	toolCallId: `tool-${ id }`,
	toolName: 'take_screenshot',
	content: [ { type: 'image', data: 'x'.repeat( bytes ), mimeType: 'image/jpeg' } ],
	isError: false,
	timestamp: id,
} );

const stripped = { content: [ { type: 'text', text: STALE_IMAGE_PLACEHOLDER_TEXT } ] };

describe( 'stripStaleImagesFromContext', () => {
	it( 'keeps the newest images that fit the budget and replaces older ones', () => {
		const messages = [ screenshot( 1, 4 ), screenshot( 2, 4 ), screenshot( 3, 4 ) ];

		const result = stripStaleImagesFromContext( { messages }, 8 );

		expect( result.messages ).toEqual( [
			expect.objectContaining( stripped ),
			messages[ 1 ],
			messages[ 2 ],
		] );
	} );

	it( 'keeps the newest images even when they alone exceed the budget', () => {
		const messages = [ screenshot( 1, 4 ), screenshot( 2, 100 ) ];

		const result = stripStaleImagesFromContext( { messages }, 10 );

		expect( result.messages ).toEqual( [ expect.objectContaining( stripped ), messages[ 1 ] ] );
	} );
} );
