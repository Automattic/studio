import css from '@eslint/css';
import { RuleTester } from 'eslint';
import { describe } from 'vitest';
import rule from '../src/rules/no-primitive-overrides';

const ruleTester = new RuleTester( {
	plugins: { css },
	language: 'css/css',
	languageOptions: { tolerant: true },
} );

const options = [ { properties: [ '--button-size' ] } ];

describe( 'no-primitive-overrides', () => {
	ruleTester.run( 'no-primitive-overrides', rule, {
		valid: [
			{ code: '.a { --button-background: var( --muted ); margin: 0; }', options },
			{ code: '.a[data-state="open"] { opacity: 0.7; }', options },
		],
		invalid: [
			{ code: '.a { --button-size: 24px; }', options, errors: [ { messageId: 'property' } ] },
			{
				code: ".a [data-slot='field-label'] { gap: 0; }",
				options,
				errors: [ { messageId: 'part' } ],
			},
			{
				code: ":global( [data-slot='empty'] ) > .a { margin: 0; }",
				options,
				errors: [ { messageId: 'part' } ],
			},
		],
	} );
} );
