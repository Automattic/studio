import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import os from 'os';
import path from 'path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { themeJsonDrops } from 'cli/ai/theme-json-files';
import type { SiteData } from 'cli/lib/cli-config/core';

// A real WordPress install to read theme JSON files with, when one is given.
const WORDPRESS = process.env.STUDIO_TEST_WORDPRESS;

const dark = {
	$schema: 'https://schemas.wp.org/trunk/theme.json',
	title: 'Dark',
	settings: { color: { palette: [ { slug: 'base', color: '#111111', name: 'Base' } ] } },
	styles: { color: { background: 'var(--wp--preset--color--base)' } },
};

describe.runIf( WORDPRESS )( 'what WordPress keeps of a theme JSON file', () => {
	let site: SiteData;
	beforeAll( () => {
		const root = mkdtempSync( path.join( os.tmpdir(), 'theme-json-files-' ) );
		cpSync( WORDPRESS!, root, { recursive: true } );
		mkdirSync( path.join( root, 'wp-content/themes/lumen/styles' ), { recursive: true } );
		site = { id: 'site', name: 'Lumen', path: root } as SiteData;
	} );
	afterAll( () => rmSync( site.path, { recursive: true, force: true } ) );

	it.each( [
		{ name: 'a variation WordPress keeps whole', json: JSON.stringify( { version: 3, ...dark } ) },
		{
			name: 'a shared block style WordPress moves to its blocks',
			json: JSON.stringify( {
				version: 3,
				...dark,
				styles: { variations: { 'section-2': { color: { text: '#fff' } } } },
			} ),
		},
		{
			name: 'a shared block style no block has',
			json: JSON.stringify( {
				version: 3,
				...dark,
				styles: { variations: { 'glow-box': { color: { text: '#fff' } } } },
			} ),
			note: 'so these change nothing on the site: styles.variations.glow-box.',
		},
		{
			name: 'a variation without a version',
			json: JSON.stringify( dark ),
			note: 'wp-content/themes/lumen/styles/dark.json has no "version", so WordPress keeps only { "version": 3 } of it (WP_Theme_JSON_Schema::migrate in wp-includes/class-wp-theme-json-schema.php, which WP_Theme_JSON runs on each theme JSON file it reads), and none of these reach the site: title, settings, styles. It reads them all with "version": 3, as Twenty Twenty-Five\'s theme JSON files have.',
		},
		{
			name: 'keys the schema has no place for',
			json: JSON.stringify( {
				version: 3,
				...dark,
				colors: { base: '#111111' },
				styles: {
					color: { background: '#111111', glow: '#fff' },
					blocks: { 'core/group': { shadow: 'none' } },
				},
			} ),
			note: 'so these change nothing on the site: styles.color.glow, colors.',
		},
		{
			name: 'a file that is not JSON',
			json: '{ "version": 3, ',
			note: 'WordPress cannot decode wp-content/themes/lumen/styles/dark.json as JSON (wp_json_file_decode in wp-includes/functions.php): Syntax error. It reads nothing from it until the file is valid JSON.',
		},
	] )( '$name', async ( { json, note } ) => {
		const relativePath = 'wp-content/themes/lumen/styles/dark.json';
		const file = path.join( site.path, relativePath );
		writeFileSync( file, json );
		const result = await themeJsonDrops( site, file, relativePath );
		if ( note ) {
			expect( result ).toContain( note );
		} else {
			expect( result ).toBeUndefined();
		}
	} );
} );
