import { RuleTester } from 'eslint';
import { describe } from 'vitest';
import rule from '../src/rules/no-module-level-translations';

const ruleTester = new RuleTester( {
	languageOptions: {
		ecmaVersion: 2022,
		sourceType: 'module',
	},
} );

describe( 'no-module-level-translations', () => {
	ruleTester.run( 'no-module-level-translations', rule, {
		valid: [
			// Wrapped in an arrow function so it stays lazy.
			{
				code: `
					import { __ } from '@wordpress/i18n';
					const getLabel = () => __( 'Hello' );
				`,
			},
			// Wrapped in a function declaration.
			{
				code: `
					import { __ } from '@wordpress/i18n';
					function getLabel() {
						return __( 'Hello' );
					}
				`,
			},
			// Lazy getters inside an object literal (the codebase pattern).
			{
				code: `
					import { __ } from '@wordpress/i18n';
					export const definition = {
						name: () => __( 'Scratchpad' ),
						labels: { add: () => __( 'New scratchpad' ) },
					};
				`,
			},
			// Translation inside a React component (a function) is fine.
			{
				code: `
					import { __ } from '@wordpress/i18n';
					function MyComponent() {
						return __( 'Title' );
					}
				`,
			},
			// Calls to non-translation functions at module level are untouched.
			{
				code: `
					const value = sprintf( '%s', 'x' );
					const id = makeId( 'thing' );
				`,
			},
			// _x / _n / _nx wrapped lazily.
			{
				code: `
					import { _n, _x, _nx } from '@wordpress/i18n';
					const a = () => _x( 'Post', 'noun' );
					const b = () => _n( 'one', 'many', 2 );
					const c = () => _nx( 'one', 'many', 2, 'ctx' );
				`,
			},
			// Bare statements whose result is discarded only feed the translation
			// extractor; they can never go stale, so they are allowed at module level.
			{
				code: `
					import { __ } from '@wordpress/i18n';
					__( 'Next' );
					__( 'Previous' );
				`,
			},
		],
		invalid: [
			// Assigned to a module-level const.
			{
				code: `
					import { __ } from '@wordpress/i18n';
					const LABEL = __( 'Build something like this' );
				`,
				errors: [ { messageId: 'moduleLevelTranslation' } ],
			},
			// Inside an object literal at module scope (not wrapped in a function).
			{
				code: `
					import { __ } from '@wordpress/i18n';
					export const config = {
						title: __( 'Settings' ),
					};
				`,
				errors: [ { messageId: 'moduleLevelTranslation' } ],
			},
			// Inside an array literal at module scope.
			{
				code: `
					import { __ } from '@wordpress/i18n';
					const ITEMS = [ __( 'First' ), __( 'Second' ) ];
				`,
				errors: [
					{ messageId: 'moduleLevelTranslation' },
					{ messageId: 'moduleLevelTranslation' },
				],
			},
			// A translation whose result is captured (here as an argument) at module
			// level is still flagged — only fully discarded statements are exempt.
			{
				code: `
					import { __ } from '@wordpress/i18n';
					const messages = [];
					messages.push( __( 'Captured translation' ) );
				`,
				errors: [ { messageId: 'moduleLevelTranslation' } ],
			},
			// Other translation helpers are caught too.
			{
				code: `
					import { _n, _x, _nx } from '@wordpress/i18n';
					const A = _x( 'Post', 'noun' );
					const B = _n( 'one', 'many', 2 );
					const C = _nx( 'one', 'many', 2, 'ctx' );
				`,
				errors: [
					{ messageId: 'moduleLevelTranslation' },
					{ messageId: 'moduleLevelTranslation' },
					{ messageId: 'moduleLevelTranslation' },
				],
			},
		],
	} );
} );
