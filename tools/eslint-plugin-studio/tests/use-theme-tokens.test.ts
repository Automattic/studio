import css from '@eslint/css';
import { RuleTester } from 'eslint';
import { describe } from 'vitest';
import rule from '../src/rules/use-theme-tokens';

const ruleTester = new RuleTester( {
	plugins: { css },
	language: 'css/css',
} );

const invalid = ( code: string, messageId: string ) => ( { code, errors: [ { messageId } ] } );

describe( 'use-theme-tokens', () => {
	ruleTester.run( 'use-theme-tokens', rule, {
		valid: [
			'.a { color: var( --foreground ); background: color-mix( in oklab, var( --muted ) 50%, transparent ); }',
			'.a { color: oklch( from currentColor l c h / 50% ); }',
			'.a { mask-image: linear-gradient( to bottom, transparent, black 20px ); }',
			'.a { font-size: var( --text-sm ); }',
			'.a { font-size: 0.9em; }',
			'.a { border-radius: var( --radius-md ); }',
			'.a { border-radius: 0 inherit; }',
			'.a { border-radius: calc( var( --radius-md ) + 6px ); }',
			'.a { box-shadow: inset 0 0 0 1px var( --border ), var( --shadow-sm ); }',
			'.a { box-shadow: 0 0 0 2px var( --ring ); }',
			'.a { z-index: 1; }',
			'.a { z-index: var( --z-popover ); }',
			'.a { white-space: nowrap; }',
		],
		invalid: [
			invalid( '.a { color: #fff; }', 'color' ),
			invalid( '.a { background: rgb( 0 0 0 / 10% ); }', 'color' ),
			invalid( '.a { border-color: white; }', 'color' ),
			invalid( '.a { font-size: 11px; }', 'fontSize' ),
			invalid( '.a { font-size: 1.25rem; }', 'fontSize' ),
			invalid( '.a { border-radius: 6px; }', 'radius' ),
			invalid( '.a { border-top-left-radius: 0.5rem; }', 'radius' ),
			invalid( '.a { box-shadow: 0 1px 3px var( --border ); }', 'shadow' ),
			invalid( '.a { z-index: 40; }', 'zIndex' ),
		],
	} );
} );
