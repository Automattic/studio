import { mkdirSync, mkdtempSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { Type } from 'typebox';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { runServedTool } from 'cli/ai/runtimes/mcp/served-tool';
import { defineTool, READ_ONLY } from 'cli/ai/tools/define-tool';
import { resolveSite } from 'cli/ai/tools/utils';

vi.mock( 'cli/ai/tools/utils', async ( importOriginal ) => ( {
	...( await importOriginal< typeof import('cli/ai/tools/utils') >() ),
	resolveSite: vi.fn(),
} ) );

const HEADER = '<!-- wp:navigation /-->';

const showHeader = defineTool(
	'show_header',
	'Shows the header.',
	{ nameOrPath: Type.String() },
	async () => ( { content: [ { type: 'text', text: HEADER } ] } ),
	{ annotations: READ_ONLY }
);

describe( 'runServedTool', () => {
	let sitePath: string;

	beforeEach( () => {
		sitePath = mkdtempSync( path.join( tmpdir(), 'served-tool-' ) );
		const blockDir = path.join( sitePath, 'wp-includes', 'blocks', 'navigation' );
		mkdirSync( blockDir, { recursive: true } );
		writeFileSync(
			path.join( blockDir, 'block.json' ),
			JSON.stringify( {
				attributes: { submenuVisibility: { type: 'string', enum: [ 'hover', 'click' ] } },
			} )
		);
		vi.mocked( resolveSite ).mockResolvedValue( { path: sitePath } as never );
	} );

	it( "adds the declared settings of the core blocks a result shows, from the call's site", async () => {
		const result = await runServedTool( showHeader, { nameOrPath: 'My Site' } );

		expect( resolveSite ).toHaveBeenCalledWith( 'My Site' );
		expect( result.isError ).toBe( false );
		expect( result.content ).toEqual( [
			{ type: 'text', text: HEADER },
			{
				type: 'text',
				text: expect.stringMatching(
					/^core\/navigation settings, declared in .*\/wp-includes\/blocks\/navigation\/block\.json: submenuVisibility \("hover"\|"click"\)\.$/
				),
			},
		] );
		// Every result describes its own blocks.
		expect( ( await runServedTool( showHeader, { nameOrPath: 'My Site' } ) ).content ).toHaveLength(
			2
		);
	} );

	it( 'adds nothing when the call names no site or the site is not found', async () => {
		expect( ( await runServedTool( showHeader, {} ) ).content ).toHaveLength( 1 );

		vi.mocked( resolveSite ).mockRejectedValue( new Error( 'Site not found' ) );
		expect( ( await runServedTool( showHeader, { nameOrPath: 'Missing' } ) ).content ).toHaveLength(
			1
		);
	} );
} );
