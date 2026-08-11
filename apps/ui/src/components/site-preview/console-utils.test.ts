import { describe, expect, it } from 'vitest';
import {
	appendPreviewConsoleEntriesToPrompt,
	formatPreviewConsoleEntriesForText,
	getPreviewConsoleLevelFromWebviewLevel,
	stripPreviewConsolePromptBlock,
} from './console-utils';
import type { PreviewConsoleEntry } from './types';

function createEntry( overrides: Partial< PreviewConsoleEntry > = {} ): PreviewConsoleEntry {
	return {
		id: 'entry-1',
		level: 'error',
		message: 'Uncaught TypeError: nope',
		timestamp: Date.UTC( 2026, 0, 2, 3, 4, 5 ),
		sourceId: 'http://localhost:8881/wp-content/themes/example/app.js',
		lineNumber: 12,
		...overrides,
	};
}

describe( 'site-preview console utils', () => {
	it( 'maps Electron webview console levels to preview levels', () => {
		expect( getPreviewConsoleLevelFromWebviewLevel( 0 ) ).toBe( 'debug' );
		expect( getPreviewConsoleLevelFromWebviewLevel( 1 ) ).toBe( 'info' );
		expect( getPreviewConsoleLevelFromWebviewLevel( 2 ) ).toBe( 'warning' );
		expect( getPreviewConsoleLevelFromWebviewLevel( 3 ) ).toBe( 'error' );
		expect( getPreviewConsoleLevelFromWebviewLevel( 99 ) ).toBe( 'log' );
	} );

	it( 'formats entries for copying or agent context', () => {
		expect( formatPreviewConsoleEntriesForText( [ createEntry() ] ) ).toBe(
			'[2026-01-02T03:04:05.000Z] ERROR Uncaught TypeError: nope (app.js:12)'
		);
	} );

	it( 'adds a removable browser console block to hidden prompts', () => {
		const prompt = 'Please debug the homepage.';
		const withConsole = appendPreviewConsoleEntriesToPrompt( prompt, [ createEntry() ] );

		expect( withConsole ).toContain( prompt );
		expect( withConsole ).toContain( 'Recent browser console output from the in-app preview:' );
		expect( withConsole ).toContain( 'Uncaught TypeError: nope' );
		expect( stripPreviewConsolePromptBlock( withConsole ) ).toBe( prompt );
	} );
} );
