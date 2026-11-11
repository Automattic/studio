import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'fs/promises';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { installCuratedAdmin, parseCurateAdminManifest } from '@studio/agent/shared/curate-admin';
import { createFakeHost } from './fake-host';
import type { HostSite, StudioAgentHost } from '@studio/agent/shared/host';

const PAGES = 'edit.php?post_type=page';

const DESIGN = `---
colors:
  primary: "#c2552b"
  background: "#ffffff"
  text: "#111111"
typography:
  display:
    fontFamily: "Fraunces"
---
`;

const manifest = {
	audience: 'staff',
	role: { slug: 'fern_staff', name: 'Fern & Fig staff', extends: 'editor' },
	menu: { keep: [ { screen: 'edit.php' }, { screen: PAGES, only: [ 'about' ] } ] },
	postTypes: [
		{
			slug: 'dish',
			singular: 'Dish',
			plural: 'Dishes',
			previewPath: '/menu/',
			fields: [ { key: 'price', label: 'Price', type: 'text' } ],
		},
	],
};

const forEveryone = {
	...manifest,
	audience: 'everyone',
	menu: { hide: [ 'plugins.php', 'tools.php' ] },
};

describe( 'parseCurateAdminManifest', () => {
	it( 'accepts a valid manifest', () => {
		expect( parseCurateAdminManifest( manifest ).postTypes ).toHaveLength( 1 );
		expect( parseCurateAdminManifest( forEveryone ).menu.hide ).toHaveLength( 2 );
	} );

	it.each( [
		[
			'a built-in role, which would change every editor',
			{ ...manifest, role: { ...manifest.role, slug: 'editor' } },
			/must be a new role/,
		],
		[
			'losing publish_pages while pages stay, which takes live pages offline on save',
			{ ...manifest, role: { ...manifest.role, remove: [ 'publish_pages' ] } },
			/keep publish_pages/,
		],
		[ 'a staff account with no menu to keep', { ...manifest, menu: {} }, /menu\.keep/ ],
		[
			'a hide list for staff, who only get what is kept',
			{ ...manifest, menu: { ...manifest.menu, hide: [ 'tools.php' ] } },
			/leave out menu\.hide/,
		],
		[ 'everyone with nothing to hide', { ...forEveryone, menu: {} }, /menu\.hide/ ],
		[
			'a lock on something other than pages',
			{ ...manifest, menu: { keep: [ { screen: 'edit.php', lock: 'contentOnly' } ] } },
			/only and lock are for/,
		],
		[
			'a screen that is not an admin screen',
			{ ...manifest, menu: { keep: [ { screen: 'https://example.com' } ] } },
			/inspect_wp_admin/,
		],
		[
			'redefining a built-in post type',
			{ ...manifest, postTypes: [ { ...manifest.postTypes[ 0 ], slug: 'post' } ] },
			/must be a new post type/,
		],
		[
			'sorting by a field the post type does not have',
			{
				...manifest,
				postTypes: [ { ...manifest.postTypes[ 0 ], order: { field: 'starts_on' } } ],
			},
			/one of this post type's fields/,
		],
		[
			'upcoming on a field that is not a date',
			{
				...manifest,
				postTypes: [ { ...manifest.postTypes[ 0 ], order: { field: 'price', upcoming: true } } ],
			},
			/needs a date field/,
		],
		[
			'a post type that nothing on the site shows',
			{ ...manifest, postTypes: [ { ...manifest.postTypes[ 0 ], previewPath: undefined } ] },
			/needs previewPath/,
		],
		[
			'an archive on a post type with no URLs',
			{ ...manifest, postTypes: [ { ...manifest.postTypes[ 0 ], hasArchive: true } ] },
			/needs public: true/,
		],
		[
			'fields on a post type with no editor to show them in',
			{ ...manifest, postTypes: [ { ...manifest.postTypes[ 0 ], supports: [ 'title' ] } ] },
			/add it to supports/,
		],
		[
			'a requests widget with nobody to send them to',
			{
				...manifest,
				dashboard: { widgets: [ { id: 'ask', type: 'requests', title: 'Ask' } ] },
			},
			/needs an agency/,
		],
		[
			"a manifest that doesn't say who it is for",
			{ ...manifest, audience: undefined },
			/from the answer to the first question/,
		],
		[ 'a key the manifest does not define', { ...manifest, menuz: [] }, /menuz/ ],
	] )( 'rejects %s', ( _name, input, message ) => {
		expect( () => parseCurateAdminManifest( input ) ).toThrow( message );
	} );
} );

describe( 'installCuratedAdmin', () => {
	const stdoutFor = ( args: string[] ) => {
		if ( args[ 0 ] === 'post' ) {
			return 'home\nabout\n';
		}
		return args[ 0 ] === 'eval' && args[ 1 ].includes( 'get_locale' ) ? 'en_US' : '';
	};

	let site: HostSite;
	let wpCli: Mock< StudioAgentHost[ 'sites' ][ 'wpCli' ] >;
	let host: StudioAgentHost;

	const installed = async () =>
		JSON.parse(
			await readFile(
				path.join( site.path, 'wp-content/plugins/curate-admin-site/curate-admin.json' ),
				'utf8'
			)
		);

	beforeEach( async () => {
		const sitePath = await mkdtemp( path.join( os.tmpdir(), 'curate-admin-' ) );
		await mkdir( path.join( sitePath, 'wp-content/plugins' ), { recursive: true } );
		site = { id: '1', name: 'Fern', path: sitePath, url: 'http://localhost:1', phpVersion: '8.4' };
		wpCli = vi.fn( async ( _site: HostSite, args: string[] ) => ( {
			// No Staff account yet.
			exitCode: args[ 0 ] === 'user' && args[ 1 ] === 'get' ? 1 : 0,
			stdout: stdoutFor( args ),
			stderr: '',
		} ) );
		const fake = createFakeHost();
		host = { ...fake, sites: { ...fake.sites, isRunning: async () => true, wpCli } };
	} );

	afterEach( async () => {
		await rm( site.path, { recursive: true, force: true } );
	} );

	it( 'writes the manifest and activates both plugins', async () => {
		await installCuratedAdmin( host, site, manifest );

		expect( ( await installed() ).role.slug ).toBe( 'fern_staff' );
		expect( wpCli ).toHaveBeenCalledWith( site, [
			'plugin',
			'activate',
			'curate-admin',
			'curate-admin-site',
		] );
	} );

	it( 'copies the runtime in', async () => {
		await installCuratedAdmin( host, site, manifest );

		const runtime = path.join( site.path, 'wp-content/plugins/curate-admin' );
		expect( await readdir( runtime ) ).toContain( 'curate-admin.php' );
		expect( await readdir( path.join( runtime, 'assets' ) ) ).toContain( 'editor.js' );
	} );

	it( "lists the runtime's strings for a site that isn't in English", async () => {
		wpCli.mockImplementation( async ( _site, args ) => ( {
			exitCode: args[ 0 ] === 'user' && args[ 1 ] === 'get' ? 1 : 0,
			stdout: args[ 1 ]?.includes( 'get_locale' ) ? 'fr_FR' : stdoutFor( args ),
			stderr: '',
		} ) );

		const { untranslated } = await installCuratedAdmin( host, site, manifest );

		expect( untranslated ).toEqual( expect.arrayContaining( [ 'Full admin', 'Send request' ] ) );
	} );

	it( 'creates the Staff account with the role, under a login Studio can read', async () => {
		await installCuratedAdmin( host, site, { ...manifest, staff: { name: 'Maria Lopez' } } );

		expect( ( await installed() ).staff.login ).toBe( 'fern-staff' );
		const create = wpCli.mock.calls.find( ( [ , args ] ) => args[ 1 ] === 'create' )?.[ 1 ];
		expect( create ).toEqual(
			expect.arrayContaining( [
				'fern-staff',
				'fern-staff@staff.invalid',
				'--role=fern_staff',
				'--first_name=Maria',
				'--display_name=Maria Lopez',
			] )
		);
	} );

	it( 'calls the account and the role Staff unless told otherwise', async () => {
		await installCuratedAdmin( host, site, { audience: 'staff', menu: manifest.menu } );

		const written = await installed();
		expect( written.role ).toMatchObject( { slug: 'staff', name: 'Staff', extends: 'editor' } );
		expect( written.staff ).toEqual( { name: 'Staff', login: 'staff' } );
	} );

	it( 'sets up no role or account when curating for everyone', async () => {
		await installCuratedAdmin( host, site, forEveryone );

		const written = await installed();
		expect( written.audience ).toBe( 'everyone' );
		expect( written ).not.toHaveProperty( 'role' );
		expect( written ).not.toHaveProperty( 'staff' );
		expect( wpCli.mock.calls.some( ( [ , args ] ) => args[ 0 ] === 'user' ) ).toBe( false );
	} );

	it( 'removes the Staff account when moving to everyone', async () => {
		await installCuratedAdmin( host, site, manifest );
		wpCli.mockClear();

		await installCuratedAdmin( host, site, forEveryone );

		const commands = wpCli.mock.calls.map( ( [ , args ] ) => args.slice( 0, 3 ).join( ' ' ) );
		expect( commands ).toContain( 'user delete fern-staff' );
		expect( commands ).toContain( 'role delete fern_staff' );
	} );

	it( 'keeps its own account on a second install', async () => {
		wpCli.mockImplementation( async ( _site: HostSite, args: string[] ) => ( {
			exitCode: 0,
			stdout: args[ 1 ] === 'get' ? 'fern_staff\n' : stdoutFor( args ),
			stderr: '',
		} ) );

		await installCuratedAdmin( host, site, manifest );

		expect( wpCli.mock.calls.some( ( [ , args ] ) => args[ 1 ] === 'create' ) ).toBe( false );
	} );

	it( 'leaves a real user alone when the login is taken', async () => {
		wpCli.mockImplementation( async ( _site: HostSite, args: string[] ) => ( {
			exitCode: 0,
			stdout: args[ 1 ] === 'get' ? 'administrator\n' : stdoutFor( args ),
			stderr: '',
		} ) );

		await expect( installCuratedAdmin( host, site, manifest ) ).rejects.toThrow(
			/already exists with the role administrator/
		);
		expect( wpCli.mock.calls.some( ( [ , args ] ) => args[ 1 ] === 'set-role' ) ).toBe( false );
	} );

	it( 'leaves the admin colors alone unless the manifest asks for a brand', async () => {
		await writeFile( path.join( site.path, 'DESIGN.md' ), DESIGN );

		await installCuratedAdmin( host, site, manifest );

		expect( await installed() ).not.toHaveProperty( 'brand' );
	} );

	it( 'takes the brand from DESIGN.md, keeping what the manifest sets', async () => {
		await writeFile( path.join( site.path, 'DESIGN.md' ), DESIGN );

		await installCuratedAdmin( host, site, { ...manifest, brand: { name: 'Fern & Fig' } } );

		expect( ( await installed() ).brand ).toEqual( {
			name: 'Fern & Fig',
			displayFont: 'Fraunces',
			accent: '#c2552b',
			accentText: '#ffffff',
			// A dark shade of the accent, so the sidebar's white text stays readable.
			sidebar: '#6b2f18',
			sidebarText: '#ffffff',
		} );
	} );

	it( 'refuses pages the site does not have, before changing anything', async () => {
		await expect(
			installCuratedAdmin( host, site, {
				...manifest,
				menu: { keep: [ { screen: PAGES, only: [ 'nope' ] } ] },
			} )
		).rejects.toThrow( /nope/ );

		expect( wpCli ).toHaveBeenCalledTimes( 1 );
	} );

	it( 'refuses a post type another plugin owns', async () => {
		wpCli.mockImplementation( async ( _site: HostSite, args: string[] ) => ( {
			exitCode: 0,
			stdout: args[ 0 ] === 'post' ? 'about\n' : 'dish ',
			stderr: '',
		} ) );

		await expect( installCuratedAdmin( host, site, manifest ) ).rejects.toThrow(
			/already exist.*dish/
		);
	} );

	it( 'needs the site running', async () => {
		host.sites.isRunning = async () => false;
		await expect( installCuratedAdmin( host, site, manifest ) ).rejects.toThrow( /site_start/ );
	} );
} );
