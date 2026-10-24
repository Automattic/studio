import { mkdirSync, rmSync, writeFileSync } from 'fs';
import path from 'path';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { childThemeCopies } from 'cli/ai/child-theme-copies';
import { SiteChanges } from 'cli/ai/site-changes';
import { createSite } from 'cli/ai/tests/fixtures/wordpress-site';
import type { OpenProblems } from 'cli/ai/open-problems';
import type { SiteData } from 'cli/lib/cli-config/core';

let fixture: ReturnType< typeof createSite >;
let site: SiteData;

// Writes a theme file as any tool or script would.
const write = ( file: string, content: string ) => {
	const target = path.join( fixture.root, 'wp-content/themes', file );
	mkdirSync( path.dirname( target ), { recursive: true } );
	writeFileSync( target, content );
};
const remove = ( file: string ) => rmSync( path.join( fixture.root, 'wp-content/themes', file ) );

const HEADER = '<!-- wp:site-title /-->';
const THEME_JSON = '{"version":3,"settings":{"color":{"palette":[]}}}';

beforeEach( () => {
	fixture = createSite();
	write( 'bakery-parent/parts/header.html', HEADER );
	write( 'bakery-parent/theme.json', THEME_JSON );
	write( 'bakery-parent/screenshot.png', 'png' );
	write( 'kid/style.css', '/*\nTheme Name: Kid\nTemplate: bakery-parent\n*/' );
	site = { id: '1', name: 'Bakery', path: fixture.root } as SiteData;
} );

afterEach( () => rmSync( fixture.root, { recursive: true, force: true } ) );

const problemsAfter = async ( check: SiteChanges, change: () => void ) => {
	await check.snapshot();
	change();
	return ( await check.settle() ).problems;
};

it.each( [
	{ name: 'nothing', change: () => {}, copies: undefined },
	{
		name: "a copy of the parent's files",
		change: () => {
			write( 'kid/parts/header.html', HEADER );
			write( 'kid/theme.json', THEME_JSON );
		},
		copies: 'parts/header.html, theme.json',
	},
	{
		name: "a changed copy of the parent's file",
		change: () => write( 'kid/theme.json', '{"version":3,"settings":{}}' ),
		copies: undefined,
	},
	{
		name: 'a file the parent lacks',
		change: () => write( 'kid/templates/home.html', HEADER ),
		copies: undefined,
	},
	{
		name: "the parent's screenshot, which WordPress reads only from the child",
		change: () => write( 'kid/screenshot.png', 'png' ),
		copies: undefined,
	},
	{
		name: 'a theme that names itself as its parent, which WordPress refuses',
		change: () => write( 'kid/style.css', '/*\nTheme Name: Kid\nTemplate: kid\n*/' ),
		copies: undefined,
	},
	{
		name: 'the same file in a theme that is no child',
		change: () => write( 'twentytwentyfive/parts/header.html', HEADER ),
		copies: undefined,
	},
] )( 'reports $name', async ( { change, copies } ) => {
	const check = new SiteChanges( undefined, async () => [ site ], [ childThemeCopies ] );
	const problems = await problemsAfter( check, change );
	expect( problems ).toEqual(
		copies
			? [
					expect.stringContaining(
						`The child theme kid holds files of its parent bakery-parent unchanged: ${ copies }.`
					),
			  ]
			: []
	);
} );

it( 'reports a copy once, and keeps it open until it is changed or deleted', async () => {
	// The problem of each key, as the turn's open problems record it.
	const recorded = new Map< string, string | undefined >();
	const open = {
		record: ( _site: string, key: string, problem?: string ) => recorded.set( key, problem ),
	} as OpenProblems;
	const check = new SiteChanges( open, async () => [ site ], [ childThemeCopies ] );
	const isOpen = () => [ ...recorded.values() ].some( Boolean );

	// A changed file stays the child's own while neither file changes.
	write( 'kid/parts/header.html', '<!-- wp:site-logo /-->' );
	expect( await problemsAfter( check, () => write( 'kid/theme.json', THEME_JSON ) ) ).toHaveLength(
		1
	);
	expect( await problemsAfter( check, () => write( 'kid/functions.php', '<?php' ) ) ).toEqual( [] );
	expect( isOpen() ).toBe( true );
	// The parent's file changes under the copy, as an update would change it.
	await problemsAfter( check, () => write( 'bakery-parent/theme.json', '{"version":3}' ) );
	expect( isOpen() ).toBe( false );
	await problemsAfter( check, () => write( 'bakery-parent/theme.json', THEME_JSON ) );
	expect( isOpen() ).toBe( true );
	await problemsAfter( check, () => remove( 'kid/theme.json' ) );
	expect( isOpen() ).toBe( false );
} );
