import { mkdir, mkdtemp, rm } from 'fs/promises';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { DESIGN_SYSTEM_PREVIEW_PATH } from '@studio/agent/protocol/chat-artifacts';
import { withDesignSystemPreview } from '@studio/agent/shared/chat-artifacts';
import { createFakeHost } from './fake-host';
import type { AgentToolResult } from '@earendil-works/pi-agent-core';

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
	const result: AgentToolResult< unknown > = {
		content: [ { type: 'text', text: 'File updated.' } ],
		details: { diff: 'Updated design token' },
	};
	const write = withDesignSystemPreview(
		{
			description: 'Write a file.',
			execute: vi
				.fn< ( id: string, params: { path?: unknown } ) => Promise< AgentToolResult< unknown > > >()
				.mockResolvedValue( result ),
		},
		{ ...createFakeHost( sitesRoot ), ui }
	);

	await expect( write.execute( 'call-1', { path: 'bakery/notes/DESIGN.md' } ) ).resolves.toBe(
		result
	);
	await write.execute( 'call-2', { path: 'bakery/style.css' } );
	expect( ui.showArtifact ).not.toHaveBeenCalled();

	expect( write.description ).toContain( '[Design System](studio:design-system)' );

	const updated = await write.execute( 'call-3', { path: 'bakery/DESIGN.md' } );
	expect( updated.content ).toContainEqual( {
		type: 'text',
		text: expect.stringContaining( '[Design System](studio:design-system)' ),
	} );
	expect( updated.content[ 0 ] ).toEqual( result.content[ 0 ] );
	expect( updated.details ).toBe( result.details );
	expect( ui.showArtifact ).toHaveBeenCalledWith(
		expect.objectContaining( {
			widgets: [ { type: 'site-preview', widgetProps: { path: DESIGN_SYSTEM_PREVIEW_PATH } } ],
		} )
	);
} );

it( 'keeps a failed file result unchanged without offering the design system', async () => {
	const ui = { showArtifact: vi.fn(), reloadPreview: vi.fn() };
	const result: AgentToolResult< unknown > = {
		content: [ { type: 'text', text: 'The file could not be updated.' } ],
		details: undefined,
		isError: true,
	};
	const write = withDesignSystemPreview(
		{ execute: vi.fn().mockResolvedValue( result ) },
		{ ...createFakeHost( sitesRoot ), ui }
	);
	await expect( write.execute( 'failed', { path: 'bakery/DESIGN.md' } ) ).resolves.toBe( result );
	expect( ui.showArtifact ).not.toHaveBeenCalled();
} );

it( 'keeps file tools unchanged when no Studio UI is attached', () => {
	const tool = { description: 'Write a file.', execute: vi.fn() };
	expect( withDesignSystemPreview( tool, createFakeHost( sitesRoot ) ) ).toBe( tool );
	expect( tool.description ).not.toContain( 'studio:design-system' );
} );
