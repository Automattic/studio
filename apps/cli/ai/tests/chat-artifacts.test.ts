import { mkdir, mkdtemp, rm } from 'fs/promises';
import os from 'os';
import path from 'path';
import { DESIGN_SYSTEM_PREVIEW_PATH } from '@studio/common/ai/chat-artifacts';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { withDesignSystemPreview } from 'cli/ai/chat-artifacts';
import { emitEvent } from 'cli/ai/json-events';

vi.mock( 'cli/ai/json-events', () => ( { emitEvent: vi.fn() } ) );

let sitesRoot: string;

beforeEach( async () => {
	sitesRoot = await mkdtemp( path.join( os.tmpdir(), 'studio-chat-artifacts-' ) );
	await mkdir( path.join( sitesRoot, 'bakery', 'wp-content' ), { recursive: true } );
} );

afterEach( async () => {
	vi.clearAllMocks();
	await rm( sitesRoot, { recursive: true, force: true } );
} );

it( "opens the design system in the preview when a site's DESIGN.md is written", async () => {
	const write = withDesignSystemPreview(
		{
			execute: vi
				.fn< ( id: string, params: { path?: unknown } ) => Promise< string > >()
				.mockResolvedValue( 'ok' ),
		},
		sitesRoot
	);

	await expect( write.execute( 'call-1', { path: 'bakery/notes/DESIGN.md' } ) ).resolves.toBe(
		'ok'
	);
	await write.execute( 'call-2', { path: 'bakery/style.css' } );
	expect( emitEvent ).not.toHaveBeenCalled();

	await write.execute( 'call-3', { path: 'bakery/DESIGN.md' } );
	expect( emitEvent ).toHaveBeenCalledWith(
		expect.objectContaining( {
			type: 'chat.artifact',
			artifact: expect.objectContaining( {
				widgets: [ { type: 'site-preview', widgetProps: { path: DESIGN_SYSTEM_PREVIEW_PATH } } ],
			} ),
		} )
	);
} );
