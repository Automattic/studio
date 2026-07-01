import { BlueprintV1Declaration } from '@wp-playground/blueprints';
import {
	extractFormValuesFromBlueprint,
	generateDefaultBlueprintDescription,
	updateBlueprintWithFormValues,
} from '../blueprint-settings';

describe( 'blueprint-settings', () => {
	describe( 'extractFormValuesFromBlueprint', () => {
		it( 'should return empty object for empty blueprint', () => {
			const result = extractFormValuesFromBlueprint( {} );

			expect( result ).toEqual( {} );
		} );

		it( 'should extract WP and PHP versions from preferredVersions', () => {
			const blueprint: BlueprintV1Declaration = {
				preferredVersions: {
					php: '8.2',
					wp: '6.5',
				},
			};

			const result = extractFormValuesFromBlueprint( blueprint );

			expect( result.phpVersion ).toBe( '8.2' );
			expect( result.wpVersion ).toBe( '6.5' );
		} );

		it( 'should ignore "latest" PHP version', () => {
			const blueprint: BlueprintV1Declaration = {
				preferredVersions: {
					php: 'latest',
					wp: '6.5',
				},
			};

			const result = extractFormValuesFromBlueprint( blueprint );

			expect( result.phpVersion ).toBeUndefined();
		} );

		it( 'should ignore "latest" WP version', () => {
			const blueprint: BlueprintV1Declaration = {
				preferredVersions: {
					php: '8.2',
					wp: 'latest',
				},
			};

			const result = extractFormValuesFromBlueprint( blueprint );

			expect( result.wpVersion ).toBeUndefined();
		} );

		it( 'should extract custom domain from defineSiteUrl step with https', () => {
			const blueprint: BlueprintV1Declaration = {
				steps: [ { step: 'defineSiteUrl', siteUrl: 'https://mysite.local' } ],
			};

			const result = extractFormValuesFromBlueprint( blueprint );

			expect( result.customDomain ).toBe( 'mysite.local' );
			expect( result.enableHttps ).toBe( true );
		} );

		it( 'should extract custom domain from defineSiteUrl step with http', () => {
			const blueprint: BlueprintV1Declaration = {
				steps: [ { step: 'defineSiteUrl', siteUrl: 'http://mysite.local' } ],
			};

			const result = extractFormValuesFromBlueprint( blueprint );

			expect( result.customDomain ).toBe( 'mysite.local' );
			expect( result.enableHttps ).toBe( false );
		} );

		it( 'should strip port from custom domain', () => {
			const blueprint: BlueprintV1Declaration = {
				steps: [ { step: 'defineSiteUrl', siteUrl: 'https://mysite.local:8443' } ],
			};

			const result = extractFormValuesFromBlueprint( blueprint );

			expect( result.customDomain ).toBe( 'mysite.local' );
			expect( result.enableHttps ).toBe( true );
		} );

		it( 'should handle invalid URL in defineSiteUrl gracefully', () => {
			const blueprint: BlueprintV1Declaration = {
				steps: [ { step: 'defineSiteUrl', siteUrl: 'not-a-valid-url' } ],
			};

			const result = extractFormValuesFromBlueprint( blueprint );

			expect( result.customDomain ).toBeUndefined();
			expect( result.enableHttps ).toBeUndefined();
		} );

		it( 'should extract all values from a complete blueprint', () => {
			const blueprint: BlueprintV1Declaration = {
				preferredVersions: {
					php: '8.2',
					wp: '6.4',
				},
				steps: [ { step: 'defineSiteUrl', siteUrl: 'https://dev.local' } ],
			};

			const result = extractFormValuesFromBlueprint( blueprint );

			expect( result ).toEqual( {
				phpVersion: '8.2',
				wpVersion: '6.4',
				customDomain: 'dev.local',
				enableHttps: true,
			} );
		} );

		it( 'should ignore steps array that is not an array', () => {
			const blueprint = {
				steps: 'not-an-array',
			} as unknown as BlueprintV1Declaration;

			const result = extractFormValuesFromBlueprint( blueprint );

			expect( result.customDomain ).toBeUndefined();
		} );

		it( 'should handle defineSiteUrl step without siteUrl property', () => {
			const blueprint = {
				steps: [ { step: 'defineSiteUrl' } ],
			} as BlueprintV1Declaration;

			const result = extractFormValuesFromBlueprint( blueprint );

			expect( result.customDomain ).toBeUndefined();
		} );

		// Login credentials extraction tests
		it( 'should not extract credentials when there is no login', () => {
			const blueprint: BlueprintV1Declaration = {
				steps: [
					{
						step: 'installPlugin',
						pluginData: { resource: 'wordpress.org/plugins', slug: 'akismet' },
					},
				],
			};
			const result = extractFormValuesFromBlueprint( blueprint );
			expect( result.adminUsername ).toBeUndefined();
			expect( result.adminPassword ).toBeUndefined();
		} );

		it( 'should not extract credentials for top-level login: true', () => {
			const blueprint: BlueprintV1Declaration = { login: true };
			const result = extractFormValuesFromBlueprint( blueprint );
			expect( result.adminUsername ).toBeUndefined();
			expect( result.adminPassword ).toBeUndefined();
		} );

		it( 'should extract credentials from top-level login object', () => {
			const blueprint: BlueprintV1Declaration = {
				login: { username: 'customuser', password: 'custompass' },
			};
			const result = extractFormValuesFromBlueprint( blueprint );
			expect( result.adminUsername ).toBe( 'customuser' );
			expect( result.adminPassword ).toBe( 'custompass' );
		} );

		it( 'should extract username only from top-level login', () => {
			const blueprint = {
				login: { username: 'customuser' },
			} as BlueprintV1Declaration;
			const result = extractFormValuesFromBlueprint( blueprint );
			expect( result.adminUsername ).toBe( 'customuser' );
			expect( result.adminPassword ).toBeUndefined();
		} );

		it( 'should extract password only from top-level login', () => {
			const blueprint = {
				login: { password: 'custompass' },
			} as BlueprintV1Declaration;
			const result = extractFormValuesFromBlueprint( blueprint );
			expect( result.adminUsername ).toBeUndefined();
			expect( result.adminPassword ).toBe( 'custompass' );
		} );

		it( 'should extract credentials from login step in steps array', () => {
			const blueprint: BlueprintV1Declaration = {
				steps: [
					{
						step: 'login',
						username: 'stepuser',
						password: 'steppass',
					},
				],
			};
			const result = extractFormValuesFromBlueprint( blueprint );
			expect( result.adminUsername ).toBe( 'stepuser' );
			expect( result.adminPassword ).toBe( 'steppass' );
		} );

		it( 'should extract username only from login step', () => {
			const blueprint: BlueprintV1Declaration = {
				steps: [
					{
						step: 'login',
						username: 'stepuser',
					},
				],
			};
			const result = extractFormValuesFromBlueprint( blueprint );
			expect( result.adminUsername ).toBe( 'stepuser' );
			expect( result.adminPassword ).toBeUndefined();
		} );

		it( 'should not extract credentials from login step without credentials', () => {
			const blueprint: BlueprintV1Declaration = {
				steps: [
					{
						step: 'login',
					},
				],
			};
			const result = extractFormValuesFromBlueprint( blueprint );
			expect( result.adminUsername ).toBeUndefined();
			expect( result.adminPassword ).toBeUndefined();
		} );

		it( 'should prefer top-level login credentials over steps array', () => {
			const blueprint: BlueprintV1Declaration = {
				login: { username: 'toplevel', password: 'toplevelpass' },
				steps: [
					{
						step: 'login',
						username: 'stepuser',
						password: 'steppass',
					},
				],
			};
			const result = extractFormValuesFromBlueprint( blueprint );
			expect( result.adminUsername ).toBe( 'toplevel' );
			expect( result.adminPassword ).toBe( 'toplevelpass' );
		} );

		it( 'should extract blogname from setSiteOptions step', () => {
			const blueprint: BlueprintV1Declaration = {
				steps: [ { step: 'setSiteOptions', options: { blogname: 'My Blog' } } ],
			};

			const result = extractFormValuesFromBlueprint( blueprint );

			expect( result.siteName ).toBe( 'My Blog' );
		} );

		it( 'should ignore setSiteOptions step without blogname', () => {
			const blueprint: BlueprintV1Declaration = {
				steps: [ { step: 'setSiteOptions', options: { blogdescription: 'A description' } } ],
			};

			const result = extractFormValuesFromBlueprint( blueprint );

			expect( result.siteName ).toBeUndefined();
		} );

		it( 'should use first setSiteOptions step with blogname', () => {
			const blueprint: BlueprintV1Declaration = {
				steps: [
					{ step: 'setSiteOptions', options: { blogname: 'First Name' } },
					{ step: 'setSiteOptions', options: { blogname: 'Second Name' } },
				],
			};

			const result = extractFormValuesFromBlueprint( blueprint );

			expect( result.siteName ).toBe( 'First Name' );
		} );

		it( 'should set requiresCustomDomain when enableMultisite step is present', () => {
			const blueprint: BlueprintV1Declaration = {
				steps: [ { step: 'enableMultisite' } ],
			};

			const result = extractFormValuesFromBlueprint( blueprint );

			expect( result.requiresCustomDomain ).toBe( true );
		} );

		it( 'should not set requiresCustomDomain when enableMultisite step is absent', () => {
			const blueprint: BlueprintV1Declaration = {
				steps: [
					{
						step: 'installPlugin',
						pluginData: { resource: 'wordpress.org/plugins', slug: 'akismet' },
					},
				],
			};

			const result = extractFormValuesFromBlueprint( blueprint );

			expect( result.requiresCustomDomain ).toBeUndefined();
		} );
	} );

	describe( 'updateBlueprintWithFormValues', () => {
		it( 'should return unchanged blueprint when no form values provided', () => {
			const blueprint: BlueprintV1Declaration = {
				meta: {
					author: 'Eve',
					title: 'Test',
				},
			};

			const result = updateBlueprintWithFormValues( blueprint, {} );

			expect( result ).toEqual( blueprint );
		} );

		it( 'should update PHP version when preferredVersions exists', () => {
			const blueprint: BlueprintV1Declaration = {
				preferredVersions: {
					php: '8.0',
					wp: 'latest',
				},
			};

			const result = updateBlueprintWithFormValues( blueprint, { phpVersion: '8.2' } );

			expect( result.preferredVersions?.php ).toBe( '8.2' );
		} );

		it( 'should update WP version when preferredVersions exists', () => {
			const blueprint: BlueprintV1Declaration = {
				preferredVersions: {
					php: '8.0',
					wp: '6.4',
				},
			};

			const result = updateBlueprintWithFormValues( blueprint, { wpVersion: '6.5' } );

			expect( result.preferredVersions?.wp ).toBe( '6.5' );
		} );

		it( 'should not add preferredVersions if it does not exist', () => {
			const blueprint: BlueprintV1Declaration = {
				meta: {
					author: 'Eve',
					title: 'Test',
				},
			};

			const result = updateBlueprintWithFormValues( blueprint, { phpVersion: '8.2' } );

			expect( result.preferredVersions ).toBeUndefined();
		} );

		it( 'should not update PHP version if it was not in original blueprint', () => {
			const blueprint = {
				preferredVersions: {
					wp: '6.4',
				},
			} as BlueprintV1Declaration;

			const result = updateBlueprintWithFormValues( blueprint, { phpVersion: '8.2' } );

			expect( result.preferredVersions?.php ).toBeUndefined();
		} );

		it( 'should update defineSiteUrl step with https', () => {
			const blueprint: BlueprintV1Declaration = {
				steps: [ { step: 'defineSiteUrl', siteUrl: 'http://old.local' } ],
			};

			const result = updateBlueprintWithFormValues( blueprint, {
				customDomain: 'new.local',
				enableHttps: true,
			} );

			expect( result.steps?.[ 0 ] ).toEqual( {
				step: 'defineSiteUrl',
				siteUrl: 'https://new.local',
			} );
		} );

		it( 'should update defineSiteUrl step with http', () => {
			const blueprint: BlueprintV1Declaration = {
				steps: [ { step: 'defineSiteUrl', siteUrl: 'https://old.local' } ],
			};

			const result = updateBlueprintWithFormValues( blueprint, {
				customDomain: 'new.local',
				enableHttps: false,
			} );

			expect( result.steps?.[ 0 ] ).toEqual( {
				step: 'defineSiteUrl',
				siteUrl: 'http://new.local',
			} );
		} );

		it( 'should preserve port in domain when updating', () => {
			const blueprint: BlueprintV1Declaration = {
				steps: [ { step: 'defineSiteUrl', siteUrl: 'http://old.local' } ],
			};

			const result = updateBlueprintWithFormValues( blueprint, {
				customDomain: 'new.local:8443',
				enableHttps: true,
			} );

			expect( result.steps?.[ 0 ] ).toEqual( {
				step: 'defineSiteUrl',
				siteUrl: 'https://new.local:8443',
			} );
		} );

		it( 'should not add defineSiteUrl step if it does not exist', () => {
			const blueprint: BlueprintV1Declaration = {
				steps: [ { step: 'login' } ],
			};

			const result = updateBlueprintWithFormValues( blueprint, {
				customDomain: 'new.local',
				enableHttps: true,
			} );

			expect( result.steps ).toHaveLength( 1 );
			expect( result.steps?.[ 0 ] ).toEqual( { step: 'login' } );
		} );

		it( 'should not update defineSiteUrl if customDomain is not provided', () => {
			const blueprint: BlueprintV1Declaration = {
				steps: [ { step: 'defineSiteUrl', siteUrl: 'http://old.local' } ],
			};

			const result = updateBlueprintWithFormValues( blueprint, { enableHttps: true } );

			expect( result.steps?.[ 0 ] ).toEqual( {
				step: 'defineSiteUrl',
				siteUrl: 'http://old.local',
			} );
		} );

		it( 'should not mutate the original blueprint', () => {
			const blueprint: BlueprintV1Declaration = {
				preferredVersions: {
					php: '8.0',
					wp: '6.4',
				},
				steps: [ { step: 'defineSiteUrl', siteUrl: 'http://old.local' } ],
			};
			const originalBlueprint = JSON.parse( JSON.stringify( blueprint ) );

			updateBlueprintWithFormValues( blueprint, {
				phpVersion: '8.2',
				wpVersion: '6.5',
				customDomain: 'new.local',
				enableHttps: true,
			} );

			expect( blueprint ).toEqual( originalBlueprint );
		} );

		it( 'should handle blueprint with multiple steps', () => {
			const blueprint: BlueprintV1Declaration = {
				steps: [
					{ step: 'login' },
					{ step: 'defineSiteUrl', siteUrl: 'http://old.local' },
					{
						step: 'installPlugin',
						pluginData: { resource: 'wordpress.org/plugins', slug: 'akismet' },
					},
				],
			};

			const result = updateBlueprintWithFormValues( blueprint, {
				customDomain: 'new.local',
				enableHttps: true,
			} );

			expect( result.steps ).toHaveLength( 3 );
			expect( result.steps?.[ 0 ] ).toEqual( { step: 'login' } );
			expect( result.steps?.[ 1 ] ).toEqual( {
				step: 'defineSiteUrl',
				siteUrl: 'https://new.local',
			} );
			expect( result.steps?.[ 2 ] ).toEqual( {
				step: 'installPlugin',
				pluginData: { resource: 'wordpress.org/plugins', slug: 'akismet' },
			} );
		} );

		it( 'should update blogname in existing setSiteOptions step', () => {
			const blueprint: BlueprintV1Declaration = {
				steps: [ { step: 'setSiteOptions', options: { blogname: 'Old Name' } } ],
			};

			const result = updateBlueprintWithFormValues( blueprint, {
				siteName: 'New Name',
			} );

			expect( result.steps?.[ 0 ] ).toEqual( {
				step: 'setSiteOptions',
				options: { blogname: 'New Name' },
			} );
		} );

		it( 'should not add setSiteOptions step if none exists', () => {
			const blueprint: BlueprintV1Declaration = {
				steps: [ { step: 'login' } ],
			};

			const result = updateBlueprintWithFormValues( blueprint, {
				siteName: 'New Name',
			} );

			expect( result.steps ).toHaveLength( 1 );
			expect( result.steps?.[ 0 ] ).toEqual( { step: 'login' } );
		} );

		it( 'should not modify setSiteOptions if siteName not provided', () => {
			const blueprint: BlueprintV1Declaration = {
				steps: [ { step: 'setSiteOptions', options: { blogname: 'Original Name' } } ],
			};

			const result = updateBlueprintWithFormValues( blueprint, {
				phpVersion: '8.2',
			} );

			expect( result.steps?.[ 0 ] ).toEqual( {
				step: 'setSiteOptions',
				options: { blogname: 'Original Name' },
			} );
		} );

		it( 'should preserve other options when updating blogname', () => {
			const blueprint: BlueprintV1Declaration = {
				steps: [
					{
						step: 'setSiteOptions',
						options: { blogname: 'Old Name', blogdescription: 'A description' },
					},
				],
			};

			const result = updateBlueprintWithFormValues( blueprint, {
				siteName: 'New Name',
			} );

			expect( result.steps?.[ 0 ] ).toEqual( {
				step: 'setSiteOptions',
				options: { blogname: 'New Name', blogdescription: 'A description' },
			} );
		} );
	} );

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
			const blueprint = { steps: 'not-an-array' } as unknown as BlueprintV1Declaration;
			expect( generateDefaultBlueprintDescription( blueprint ) ).toBe( '' );
		} );

		it( 'should return empty string for steps with no recognized actions', () => {
			expect( generateDefaultBlueprintDescription( { steps: [ { step: 'login' } ] } ) ).toBe( '' );
		} );

		it( 'should describe a single plugin', () => {
			const blueprint: BlueprintV1Declaration = {
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
			const blueprint: BlueprintV1Declaration = {
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
			const blueprint: BlueprintV1Declaration = {
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
			const blueprint: BlueprintV1Declaration = {
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
			const blueprint: BlueprintV1Declaration = {
				steps: [ { step: 'runPHP', code: '<? echo "hello world";' } ],
			};
			expect( generateDefaultBlueprintDescription( blueprint ) ).toBe(
				'Runs 1 block of PHP code.'
			);
		} );

		it( 'should describe PHP code, SQL queries, and WP-CLI commands combined', () => {
			const blueprint: BlueprintV1Declaration = {
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
			const blueprint: BlueprintV1Declaration = {
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
			const blueprint: BlueprintV1Declaration = {
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
			const blueprint: BlueprintV1Declaration = {
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
} );
