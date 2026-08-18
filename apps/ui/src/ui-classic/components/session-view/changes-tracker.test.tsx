import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import {
	ChangesReview,
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

describe( 'ChangesReview', () => {
	it( 'expands and collapses file diffs', async () => {
		const entries = [
			toolCallEntry( 'edit-1', 'Edit', { path: '/sites/demo/index.php' } ),
			toolResultEntry( 'edit-1', '@@ -1 +1 @@\n-old\n+new' ),
			toolCallEntry( 'edit-2', 'Edit', { path: '/sites/demo/theme.css' } ),
			toolResultEntry( 'edit-2', '@@ -1 +1 @@\n-red\n+blue' ),
		];

		render( <ChangesReview changes={ getSessionFileChanges( entries, '/sites/demo' ) } /> );

		const indexDiff = await screen.findByLabelText( 'Diff for index.php' );
		const indexButton = screen.getByRole( 'button', { name: /index\.php/ } );
		const themeButton = screen.getByRole( 'button', { name: /theme\.css/ } );
		expect( indexDiff ).toHaveTextContent( '-old' );
		expect( indexDiff ).toHaveTextContent( '+new' );
		expect( indexButton ).toHaveAttribute( 'aria-expanded', 'true' );
		expect( themeButton ).toHaveAttribute( 'aria-expanded', 'false' );

		fireEvent.click( themeButton );
		const themeDiff = await screen.findByLabelText( 'Diff for theme.css' );
		expect( themeDiff ).toHaveTextContent( '-red' );
		expect( themeDiff ).toHaveTextContent( '+blue' );
		expect( indexButton ).toHaveAttribute( 'aria-expanded', 'true' );
		expect( themeButton ).toHaveAttribute( 'aria-expanded', 'true' );

		fireEvent.click( indexButton );
		expect( indexButton ).toHaveAttribute( 'aria-expanded', 'false' );
		expect( screen.queryByLabelText( 'Diff for index.php' ) ).not.toBeInTheDocument();
	} );

	it( 'caps long previews until Show more is pressed', () => {
		const diff = Array.from( { length: 50 }, ( _, index ) => `+line ${ index + 1 }` ).join( '\n' );
		const entries = [
			toolCallEntry( 'edit-1', 'Edit', { path: '/sites/demo/index.php' } ),
			toolResultEntry( 'edit-1', diff ),
		];

		render( <ChangesReview changes={ getSessionFileChanges( entries, '/sites/demo' ) } /> );

		const indexDiff = screen.getByLabelText( 'Diff for index.php' );
		expect( indexDiff ).toHaveTextContent( '+line 40' );
		expect( indexDiff ).not.toHaveTextContent( '+line 41' );

		fireEvent.click( screen.getByRole( 'button', { name: 'Show more' } ) );
		expect( indexDiff ).toHaveTextContent( '+line 50' );
		expect( screen.getByRole( 'button', { name: 'Show less' } ) ).toBeInTheDocument();
	} );

	it( 'navigates between changed files', () => {
		const entries = [
			toolCallEntry( 'edit-1', 'Edit', { path: '/sites/demo/index.php' } ),
			toolResultEntry( 'edit-1', '-old\n+new' ),
			toolCallEntry( 'edit-2', 'Edit', { path: '/sites/demo/theme.css' } ),
			toolResultEntry( 'edit-2', '-red\n+blue' ),
		];

		render( <ChangesReview changes={ getSessionFileChanges( entries, '/sites/demo' ) } /> );

		expect( screen.getByText( '1 of 2' ) ).toBeInTheDocument();
		fireEvent.click( screen.getByRole( 'button', { name: 'Next changed file' } ) );
		expect( screen.getByText( '2 of 2' ) ).toBeInTheDocument();
		expect( screen.getByRole( 'button', { name: /theme\.css/ } ) ).toHaveAttribute(
			'aria-expanded',
			'true'
		);
	} );
} );

describe( 'formatChangeCount', () => {
	it( 'uses locale-specific number separators', () => {
		expect( formatChangeCount( 1468, 'en-US' ) ).toBe( '1,468' );
		expect( formatChangeCount( 1468, 'de-DE' ) ).toBe( '1.468' );
	} );
} );

describe( 'ChangesTracker', () => {
	it( 'opens the review surface from the file summary', async () => {
		const onOpenReview = vi.fn();
		const entries = [
			toolCallEntry( 'edit-1', 'Edit', { path: '/sites/demo/index.php' } ),
			toolResultEntry( 'edit-1', '@@ -1 +1 @@\n-old\n+new' ),
		];

		render(
			<ChangesTracker
				entries={ entries }
				ownerSitePath="/sites/demo"
				onOpenReview={ onOpenReview }
			/>
		);
		fireEvent.click( screen.getByRole( 'button', { name: 'View changed files: 1 file' } ) );
		fireEvent.click( await screen.findByRole( 'button', { name: 'Review changes' } ) );

		expect( onOpenReview ).toHaveBeenCalledOnce();
	} );

	it( 'opens a per-file summary from the pill', async () => {
		const entries = [
			toolCallEntry( 'edit-1', 'Edit', {
				path: '/sites/demo/wp-content/themes/twentytwentyfive-child/templates/front-page.html',
			} ),
			toolResultEntry( 'edit-1', '@@ -1 +1 @@\n-old\n+new' ),
		];

		render(
			<ChangesTracker entries={ entries } ownerSitePath="/sites/demo" onOpenReview={ vi.fn() } />
		);
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
			render(
				<ChangesTracker entries={ entries } ownerSitePath="/sites/demo" onOpenReview={ vi.fn() } />
			);
			expect( screen.getByText( '+1,468' ) ).toBeVisible();
		} finally {
			document.documentElement.lang = originalLanguage;
		}
	} );

	it( 'does not render without successful file changes', () => {
		const { container } = render( <ChangesTracker entries={ [] } onOpenReview={ vi.fn() } /> );
		expect( container ).toBeEmptyDOMElement();
	} );
} );
