import { mkdir, mkdtemp, rm } from 'fs/promises';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { withDesignSystemPreview } from '@studio/agent/node/chat-artifacts';
import { DESIGN_SYSTEM_PREVIEW_PATH } from '@studio/agent/protocol/chat-artifacts';

let sitesRoot: string;

beforeEach( async () => {
	sitesRoot = await mkdtemp( path.join( os.tmpdir(), 'studio-chat-artifacts-' ) );
	await mkdir( path.join( sitesRoot, 'bakery', 'wp-content' ), { recursive: true } );
} );

afterEach( async () => {
	await rm( sitesRoot, { recursive: true, force: true } );
} );

it( "opens the design system in the preview when a site's DESIGN.md is written", async () => {
	const ui = { showArtifact: vi.fn(), reloadPreview: vi.fn() };
	const write = withDesignSystemPreview(
		{
			execute: vi
				.fn< ( id: string, params: { path?: unknown } ) => Promise< string > >()
				.mockResolvedValue( 'ok' ),
		},
		sitesRoot,
		ui
	);

	await expect( write.execute( 'call-1', { path: 'bakery/notes/DESIGN.md' } ) ).resolves.toBe(
		'ok'
	);
	await write.execute( 'call-2', { path: 'bakery/style.css' } );
	expect( ui.showArtifact ).not.toHaveBeenCalled();

	await write.execute( 'call-3', { path: 'bakery/DESIGN.md' } );
	expect( ui.showArtifact ).toHaveBeenCalledWith(
		expect.objectContaining( {
			widgets: [ { type: 'site-preview', widgetProps: { path: DESIGN_SYSTEM_PREVIEW_PATH } } ],
		} )
	);
} );
