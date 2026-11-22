import { describe, expect, it } from 'vitest';
import { generateDefaultBlueprintDescription } from './blueprint-description';
import type { Blueprint } from '@studio/blueprints';

describe( 'generateDefaultBlueprintDescription', () => {
	it( 'should return empty string for empty blueprint', () => {
		expect( generateDefaultBlueprintDescription( {} ) ).toBe( '' );
	} );

	it( 'should return empty string for missing steps', () => {
		expect(
			generateDefaultBlueprintDescription( { meta: { author: 'Eve', title: 'Test' } } )
		).toBe( '' );
	} );

	it( 'should return empty string for non-array steps', () => {
		const blueprint = { steps: 'not-an-array' } as unknown as Blueprint;
		expect( generateDefaultBlueprintDescription( blueprint ) ).toBe( '' );
	} );

	it( 'should return empty string for steps with no recognized actions', () => {
		expect( generateDefaultBlueprintDescription( { steps: [ { step: 'login' } ] } ) ).toBe( '' );
	} );

	it( 'should describe a single plugin', () => {
		const blueprint: Blueprint = {
			steps: [
				{
					step: 'installPlugin',
					pluginData: { resource: 'wordpress.org/plugins', slug: 'akismet' },
				},
			],
		};
		expect( generateDefaultBlueprintDescription( blueprint ) ).toBe( 'Installs 1 plugin.' );
	} );

	it( 'should describe multiple plugins', () => {
		const blueprint: Blueprint = {
			steps: [
				{
					step: 'installPlugin',
					pluginData: { resource: 'wordpress.org/plugins', slug: 'akismet' },
				},
				{
					step: 'installPlugin',
					pluginData: { resource: 'wordpress.org/plugins', slug: 'akismet' },
				},
				{
					step: 'installPlugin',
					pluginData: { resource: 'wordpress.org/plugins', slug: 'akismet' },
				},
			],
		};
		expect( generateDefaultBlueprintDescription( blueprint ) ).toBe( 'Installs 3 plugins.' );
	} );

	it( 'should describe plugins and themes combined', () => {
		const blueprint: Blueprint = {
			steps: [
				{
					step: 'installPlugin',
					pluginData: { resource: 'wordpress.org/plugins', slug: 'akismet' },
				},
				{
					step: 'installPlugin',
					pluginData: { resource: 'wordpress.org/plugins', slug: 'akismet' },
				},
				{
					step: 'installTheme',
					themeData: { resource: 'wordpress.org/themes', slug: 'twentytwentyone' },
				},
			],
		};
		expect( generateDefaultBlueprintDescription( blueprint ) ).toBe(
			'Installs 2 plugins and 1 theme.'
		);
	} );

	it( 'should describe content import steps', () => {
		const blueprint: Blueprint = {
			steps: [
				{
					step: 'importWxr',
					file: { resource: 'url', url: 'https://example.com/starter-content.wxr' },
				},
			],
		};
		expect( generateDefaultBlueprintDescription( blueprint ) ).toBe( 'Imports content.' );
	} );

	it( 'should describe a single PHP code block', () => {
		const blueprint: Blueprint = {
			steps: [ { step: 'runPHP', code: '<? echo "hello world";' } ],
		};
		expect( generateDefaultBlueprintDescription( blueprint ) ).toBe( 'Runs 1 block of PHP code.' );
	} );

	it( 'should describe PHP code, SQL queries, and WP-CLI commands combined', () => {
		const blueprint: Blueprint = {
			steps: [
				{ step: 'runPHP', code: '<? echo "hello world";' },
				{
					step: 'runSql',
					sql: { resource: 'literal', name: 'schema.sql', contents: 'DELETE FROM wp_posts' },
				},
				{ step: 'wp-cli', command: '' },
			],
		};
		expect( generateDefaultBlueprintDescription( blueprint ) ).toBe(
			'Runs 1 block of PHP code, 1 SQL query, and 1 WP-CLI command.'
		);
	} );

	it( 'should describe site configuration steps', () => {
		const blueprint: Blueprint = {
			steps: [
				{ step: 'setSiteOptions', options: {} },
				{ step: 'defineWpConfigConsts', consts: {} },
			],
		};
		expect( generateDefaultBlueprintDescription( blueprint ) ).toBe(
			'Applies site configuration.'
		);
	} );

	it( 'should describe a complex blueprint with all categories', () => {
		const blueprint: Blueprint = {
			steps: [
				{
					step: 'installPlugin',
					pluginData: { resource: 'wordpress.org/plugins', slug: 'akismet' },
				},
				{
					step: 'installPlugin',
					pluginData: { resource: 'wordpress.org/plugins', slug: 'akismet' },
				},
				{
					step: 'installPlugin',
					pluginData: { resource: 'wordpress.org/plugins', slug: 'akismet' },
				},
				{
					step: 'installTheme',
					themeData: { resource: 'wordpress.org/themes', slug: 'twentytwentyone' },
				},
				{
					step: 'installTheme',
					themeData: { resource: 'wordpress.org/themes', slug: 'twentytwentyone' },
				},
				{
					step: 'importWxr',
					file: { resource: 'url', url: 'https://example.com/starter-content.wxr' },
				},
				{ step: 'runPHP', code: '<? echo "hello world";' },
				{
					step: 'runSql',
					sql: { resource: 'literal', name: 'schema.sql', contents: 'DELETE FROM wp_posts' },
				},
				{
					step: 'runSql',
					sql: { resource: 'literal', name: 'schema.sql', contents: 'DELETE FROM wp_posts' },
				},
				{ step: 'wp-cli', command: '' },
				{ step: 'setSiteOptions', options: {} },
				{ step: 'defineWpConfigConsts', consts: {} },
			],
		};
		expect( generateDefaultBlueprintDescription( blueprint ) ).toBe(
			'Installs 3 plugins and 2 themes. Imports content. Runs 1 block of PHP code, 2 SQL queries, and 1 WP-CLI command. Applies site configuration.'
		);
	} );

	it( 'should ignore unrecognized steps', () => {
		const blueprint: Blueprint = {
			steps: [
				{ step: 'login' },
				{
					step: 'installPlugin',
					pluginData: { resource: 'wordpress.org/plugins', slug: 'akismet' },
				},
				{ step: 'enableMultisite' },
				{ step: 'defineSiteUrl', siteUrl: 'http://example.com' },
			],
		};
		expect( generateDefaultBlueprintDescription( blueprint ) ).toBe( 'Installs 1 plugin.' );
	} );
} );
