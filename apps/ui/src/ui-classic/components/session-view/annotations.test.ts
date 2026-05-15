import { describe, expect, it } from 'vitest';
import { formatAnnotationsAsPrompt, formatAnnotationsSubmittedMessage } from './annotations';
import type { Annotation } from '@/components/site-preview/types';

describe( 'formatAnnotationsAsPrompt', () => {
	it( 'formats a compact submitted message for the visible transcript', () => {
		expect( formatAnnotationsSubmittedMessage( 1 ) ).toBe( '1 annotation submitted' );
		expect( formatAnnotationsSubmittedMessage( 2 ) ).toBe( '2 annotations submitted' );
	} );

	it( 'asks the agent to summarize, confirm, and use todos before editing', () => {
		const annotations: Annotation[] = [
			{
				id: 'a_1',
				comment: 'Make the hero heading smaller',
				selector: 'main h1',
				tag: 'h1',
				nearbyText: 'Welcome to Studio',
				url: 'http://studio.test/',
				computedStyles: {
					'font-size': '64px',
				},
			},
		];

		const prompt = formatAnnotationsAsPrompt( annotations );

		expect( prompt ).toContain( 'The user submitted 1 visual annotation' );
		expect( prompt ).toContain( 'First, reply with a markdown summary' );
		expect( prompt ).toContain( 'Use `AskUserQuestion` for that confirmation' );
		expect( prompt ).toContain( 'Do not edit files, run WP-CLI mutations, or change the site' );
		expect( prompt ).toContain(
			'call `TodoWrite` (the Todo tool) with one task for each confirmed annotation'
		);
		expect( prompt ).toContain( '- Selector: `main h1`' );
		expect( prompt ).toContain( '"comment": "Make the hero heading smaller"' );
	} );

	it( 'keeps all annotations in their original order', () => {
		const prompt = formatAnnotationsAsPrompt( [
			{
				id: 'a_1',
				comment: 'Use more contrast',
				tag: 'button',
				nearbyText: 'Buy now',
				pathname: '/pricing',
			},
			{
				id: 'a_2',
				comment: 'Add more spacing',
				tag: 'section',
				nearbyText: 'Testimonials',
				pathname: '/about',
			},
		] );

		expect( prompt.indexOf( '### 1. <button>' ) ).toBeLessThan(
			prompt.indexOf( '### 2. <section>' )
		);
		expect( prompt ).toContain( 'The user submitted 2 visual annotations' );
		expect( prompt ).toContain( '- Page: /pricing' );
		expect( prompt ).toContain( '- Page: /about' );
	} );
} );
