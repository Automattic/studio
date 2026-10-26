import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import os from 'os';
import path from 'path';
import { afterAll, beforeAll, expect, it, describe, vi } from 'vitest';
import { themeErrors } from 'cli/ai/theme-errors';
import type { SiteData } from 'cli/lib/cli-config/core';

vi.mock( 'cli/lib/daemon-client', () => ( {
	connectToDaemon: vi.fn(),
	disconnectFromDaemon: vi.fn(),
} ) );

// A real WordPress install to read themes with, when one is given.
const WORDPRESS = process.env.STUDIO_TEST_WORDPRESS;

const CHILD = '/*\nTheme Name: Paws\nTemplate: twentytwentyfive\n*/\n';
const MISSING =
	'Template is missing. Standalone themes need to have a templates/index.html or index.php template file. Child themes need to have a Template header in the style.css stylesheet.';

describe.runIf( WORDPRESS )( 'the themes a call broke, as WordPress lists them', () => {
	let site: SiteData;
	let dir: string;
	const write = ( file: string, text: string ) => {
		mkdirSync( path.dirname( path.join( dir, file ) ), { recursive: true } );
		writeFileSync( path.join( dir, file ), text );
	};
	let versions: Record< string, string >;
	// Each call's reports, against what the call before it left.
	const call = async ( change: () => void = () => undefined ) => {
		// The snapshot taken before the call, as SiteChanges takes it.
		versions = await themeErrors.read( site.path, versions );
		change();
		const after = await themeErrors.read( site.path, versions );
		const { reports, next } = await themeErrors.check( site, versions, after );
		versions = next ?? after;
		return reports;
	};
	beforeAll( async () => {
		const root = mkdtempSync( path.join( os.tmpdir(), 'theme-errors-' ) );
		cpSync( WORDPRESS!, root, { recursive: true } );
		site = { id: 'site', name: 'Paws & Whiskers', path: root } as SiteData;
		dir = path.join( root, 'wp-content/themes/paws' );
		versions = await themeErrors.read( root );
	} );
	afterAll( () => rmSync( site.path, { recursive: true, force: true } ) );

	it( 'reports a theme a call broke, until it is fixed, and leaves one being made', async () => {
		// Being made, over several calls: blockTheme's to report until WordPress lists it whole.
		expect( await call( () => write( 'theme.json', '{}' ) ) ).toEqual( [] );
		expect( await call( () => write( 'style.css', '/*\nTheme Name: Paws\n*/\n' ) ) ).toEqual( [] );
		expect( await call( () => write( 'style.css', CHILD ) ) ).toEqual( [] );
		// A CSS change leaves what WordPress lists the theme from as it was.
		expect( await call( () => write( 'style.css', `${ CHILD }body { color: red; }\n` ) ) ).toEqual(
			[]
		);

		// The header rewritten without its Template.
		expect(
			await call( () => write( 'style.css', '/* Paws custom styles. */\nbody { color: red; }\n' ) )
		).toEqual( [
			{
				key: 'theme errors paws',
				problem: `Paws & Whiskers: WordPress lists the theme paws (wp-content/themes/paws) as broken: "${ MISSING }" (WP_Theme::errors() in wp-includes/class-wp-theme.php). WordPress activates no broken theme, and switches an active one missing its files for WP_DEFAULT_THEME (validate_current_theme() in wp-includes/theme.php).`,
			},
		] );
		expect( await call( () => write( 'style.css', CHILD ) ) ).toEqual( [
			{ key: 'theme errors paws', problem: undefined },
		] );
		expect( await call() ).toEqual( [] );
	}, 60000 );

	it( 'reports a parent theme the site does not have, until it has it', async () => {
		expect(
			(
				await call( () => write( 'style.css', '/*\nTheme Name: Paws\nTemplate: kibble\n*/\n' ) )
			)[ 0 ].problem
		).toContain(
			'as broken: "The parent theme is missing. Please install the "kibble" parent theme."'
		);
		expect( await call( () => write( '../kibble/templates/index.html', '' ) ) ).toEqual( [] );
		expect(
			await call( () => write( '../kibble/style.css', '/*\nTheme Name: Kibble\n*/\n' ) )
		).toEqual( [ { key: 'theme errors paws', problem: undefined } ] );
	}, 60000 );

	it( 'reports a theme the site had when first read, once a call breaks it', async () => {
		const index = path.join( site.path, 'wp-content/themes/twentytwentyfive/templates/index.html' );
		expect( ( await call( () => rmSync( index ) ) )[ 0 ] ).toMatchObject( {
			key: 'theme errors twentytwentyfive',
			problem: expect.stringContaining( `as broken: "${ MISSING }"` ),
		} );
	}, 60000 );
} );
