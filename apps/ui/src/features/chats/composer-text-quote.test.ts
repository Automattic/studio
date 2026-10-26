import { describe, expect, it, vi } from 'vitest';
import {
	emitComposerTextQuote,
	formatComposerTextQuote,
	watchComposerTextQuote,
} from './composer-text-quote';

describe( 'composer text quotes', () => {
	it( 'formats every selected line as a Markdown blockquote followed by a blank line', () => {
		expect( formatComposerTextQuote( ' First line\nSecond line ' ) ).toBe(
			'> First line\n> Second line\n\n'
		);
	} );

	it( 'notifies active composer listeners', () => {
		const listener = vi.fn();
		const stopWatching = watchComposerTextQuote( listener );

		emitComposerTextQuote( 'Selected text' );
		stopWatching();
		emitComposerTextQuote( 'Ignored text' );

		expect( listener ).toHaveBeenCalledOnce();
		expect( listener ).toHaveBeenCalledWith( 'Selected text' );
	} );
} );
