import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import {
	ChangesTracker,
	countDiffLines,
	formatChangeCount,
	getSessionFileChanges,
} from './changes-tracker';
import type { SessionEntry } from '@earendil-works/pi-coding-agent';

function toolCallEntry(
	id: string,
	name: 'Edit' | 'Write',
	args: Record< string, unknown >
): SessionEntry {
	return {
		type: 'message',
		id: `assistant-${ id }`,
		parentId: null,
		timestamp: '2026-08-17T12:00:00.000Z',
		message: {
			role: 'assistant',
			content: [ { type: 'toolCall', id, name, arguments: args } ],
		},
	} as unknown as SessionEntry;
}

function toolResultEntry( id: string, diff?: string, isError = false ): SessionEntry {
	return {
		type: 'message',
		id: `result-${ id }`,
		parentId: null,
		timestamp: '2026-08-17T12:00:01.000Z',
		message: {
			role: 'toolResult',
			toolCallId: id,
			content: [ { type: 'text', text: 'Done' } ],
			details: diff ? { diff } : undefined,
			isError,
		},
	} as unknown as SessionEntry;
}

describe( 'getSessionFileChanges', () => {
	it( 'aggregates successful file edits and makes site paths relative', () => {
		const entries = [
			toolCallEntry( 'edit-1', 'Edit', { path: '/sites/demo/wp-content/theme.css' } ),
			toolResultEntry( 'edit-1', '@@ -1 +1 @@\n-old\n+new' ),
			toolCallEntry( 'edit-2', 'Edit', { path: '/sites/demo/wp-content/theme.css' } ),
			toolResultEntry( 'edit-2', '@@ -4 +4,2 @@\n context\n+extra' ),
			toolCallEntry( 'write-1', 'Write', { path: '/sites/demo/index.php', content: '<?php' } ),
			toolResultEntry( 'write-1' ),
		];

		expect( getSessionFileChanges( entries, '/sites/demo' ) ).toEqual( [
			expect.objectContaining( {
				displayPath: 'wp-content/theme.css',
				additions: 2,
				deletions: 1,
			} ),
			expect.objectContaining( {
				displayPath: 'index.php',
				additions: 1,
				deletions: 0,
			} ),
		] );
	} );

	it( 'ignores failed edits', () => {
		const entries = [
			toolCallEntry( 'edit-1', 'Edit', { path: '/sites/demo/index.php' } ),
			toolResultEntry( 'edit-1', '-old\n+new', true ),
		];

		expect( getSessionFileChanges( entries, '/sites/demo' ) ).toEqual( [] );
	} );

	it( 'counts each tool call at most once', () => {
		const entries = [
			toolCallEntry( 'edit-1', 'Edit', { path: '/sites/demo/index.php' } ),
			toolResultEntry( 'edit-1', '-old\n+new' ),
			toolResultEntry( 'edit-1', '-old\n+new' ),
		];

		expect( getSessionFileChanges( entries, '/sites/demo' ) ).toEqual( [
			expect.objectContaining( { additions: 1, deletions: 1 } ),
		] );
	} );
} );

describe( 'countDiffLines', () => {
	it( 'does not count diff headers', () => {
		expect( countDiffLines( '--- a/file\n+++ b/file\n-old\n+new\n context' ) ).toEqual( {
			additions: 1,
			deletions: 1,
		} );
	} );
} );

describe( 'formatChangeCount', () => {
	it( 'uses locale-specific number separators', () => {
		expect( formatChangeCount( 1468, 'en-US' ) ).toBe( '1,468' );
		expect( formatChangeCount( 1468, 'de-DE' ) ).toBe( '1.468' );
	} );
} );

describe( 'ChangesTracker', () => {
	it( 'opens a per-file summary from the pill', async () => {
		const entries = [
			toolCallEntry( 'edit-1', 'Edit', {
				path: '/sites/demo/wp-content/themes/twentytwentyfive-child/templates/front-page.html',
			} ),
			toolResultEntry( 'edit-1', '@@ -1 +1 @@\n-old\n+new' ),
		];

		render( <ChangesTracker entries={ entries } ownerSitePath="/sites/demo" /> );
		fireEvent.click( screen.getByRole( 'button', { name: 'View changed files: 1 file' } ) );

		const popup = await screen.findByRole( 'dialog' );
		expect( within( popup ).getByText( 'front-page.html' ) ).toBeVisible();
		expect(
			within( popup ).getByLabelText( 'wp-content/themes/twentytwentyfive-child/templates' )
		).toBeVisible();
		expect( within( popup ).getByText( 'wp-content/themes/twentytwentyfive-child' ) ).toBeVisible();
		expect( within( popup ).getByText( '/templates' ) ).toBeVisible();
		expect( within( popup ).getByText( '+1' ) ).toBeVisible();
		expect( within( popup ).getByText( '-1' ) ).toBeVisible();
	} );

	it( 'formats totals in the pill using the active locale', () => {
		const originalLanguage = document.documentElement.lang;
		document.documentElement.lang = 'en-US';
		const entries = [
			toolCallEntry( 'write-1', 'Write', {
				path: '/sites/demo/large.txt',
				content: Array.from( { length: 1468 }, () => 'line' ).join( '\n' ),
			} ),
			toolResultEntry( 'write-1' ),
		];

		try {
			render( <ChangesTracker entries={ entries } ownerSitePath="/sites/demo" /> );
			expect( screen.getByText( '+1,468' ) ).toBeVisible();
		} finally {
			document.documentElement.lang = originalLanguage;
		}
	} );

	it( 'does not render without successful file changes', () => {
		const { container } = render( <ChangesTracker entries={ [] } /> );
		expect( container ).toBeEmptyDOMElement();
	} );
} );
