import { RuleTester } from 'eslint';
import { describe } from 'vitest';
import rule from '../src/rules/no-redundant-cx';

const ruleTester = new RuleTester( {
	languageOptions: {
		ecmaVersion: 2020,
		sourceType: 'module',
	},
} );

describe( 'no-redundant-cx', () => {
	ruleTester.run( 'no-redundant-cx', rule, {
		valid: [
			// Conditional classes — cx() is doing real work.
			{ code: `cx( 'base', isActive && 'active' );` },
			{ code: `cx( 'base', condition ? 'a' : 'b' );` },
			// Multiple static strings still pass (rule only targets a single static arg).
			{ code: `cx( 'a', 'b' );` },
			// Single dynamic argument — leave it alone.
			{ code: `cx( className );` },
			{ code: 'cx( `text-${ size }` );' },
			// Not the cx helper.
			{ code: `clsx( 'h-full' );` },
			{ code: `foo.cx( 'h-full' );` },
		],
		invalid: [
			{
				code: `cx( 'h-full overflow-y-auto' );`,
				output: `'h-full overflow-y-auto';`,
				errors: [ { messageId: 'redundantCx' } ],
			},
			{
				code: `const className = cx( "p-4" );`,
				output: `const className = "p-4";`,
				errors: [ { messageId: 'redundantCx' } ],
			},
			{
				// Template literal with no interpolation is also a static string.
				code: 'cx( `h-full` );',
				output: '`h-full`;',
				errors: [ { messageId: 'redundantCx' } ],
			},
		],
	} );
} );
