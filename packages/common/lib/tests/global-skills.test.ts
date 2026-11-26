import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getSiteAgentFiles, removeSiteAgentFile, setSiteAgentFileEnabled } from '../agent-skills';
import { getConfigPath } from '../config/store';
import {
	getGlobalSkillDetails,
	getGlobalSkills,
	readSkillsForAgent,
	removeGlobalSkill,
	setGlobalSkillEnabled,
	updateGlobalSkill,
} from '../global-skills';

describe( 'global skills', () => {
	let root: string;
	let site: string;

	const addSkill = ( folder: string, name: string, description = `Use ${ name }.` ) => {
		fs.mkdirSync( path.join( folder, name ), { recursive: true } );
		fs.writeFileSync(
			path.join( folder, name, 'SKILL.md' ),
			`---\ndescription: ${ description }\n---\nSteps for ${ name }.`
		);
	};
	const studio = () => path.join( root, 'config', 'skills' );
	const agents = () => path.join( root, 'home', '.agents', 'skills' );
	const names = async ( sitePath?: string ) =>
		( await readSkillsForAgent( sitePath ) ).map( ( skill ) => skill.name );

	beforeEach( () => {
		root = fs.mkdtempSync( path.join( os.tmpdir(), 'studio-global-skills-' ) );
		site = path.join( root, 'site' );
		fs.mkdirSync( site );
		fs.mkdirSync( path.join( root, 'config' ) );
		process.env.DEV_CONFIG_DIR = path.join( root, 'config' );
		vi.spyOn( os, 'homedir' ).mockReturnValue( path.join( root, 'home' ) );
		fs.writeFileSync(
			getConfigPath(),
			JSON.stringify( {
				version: 1,
				sites: [ { id: 'local-a', name: 'Site', path: site, port: 8881, phpVersion: '8.3' } ],
			} )
		);
	} );

	afterEach( () => {
		vi.restoreAllMocks();
		delete process.env.DEV_CONFIG_DIR;
		fs.rmSync( root, { recursive: true, force: true } );
	} );

	it( "lists Studio's own skills as on, and the other agents' as off until switched on", async () => {
		addSkill( studio(), 'brand-voice' );
		addSkill( agents(), 'changelog' );

		expect( await getGlobalSkills() ).toEqual( [
			{
				id: 'brand-voice',
				displayName: 'Brand voice',
				description: 'Use brand-voice.',
				enabled: true,
				source: 'studio',
				directory: path.join( studio(), 'brand-voice' ),
			},
			{
				id: 'changelog',
				displayName: 'Changelog',
				description: 'Use changelog.',
				enabled: false,
				source: 'agents',
				directory: path.join( agents(), 'changelog' ),
			},
		] );
		expect( await names() ).toEqual( [ 'brand-voice' ] );
	} );

	describe( "a skill from the other agents' folder", () => {
		const link = () => path.join( studio(), 'changelog' );
		const original = () => path.join( agents(), 'changelog', 'SKILL.md' );
		const find = async ( source: string ) =>
			( await getGlobalSkills() ).find(
				( skill ) => skill.source === source && skill.id === 'changelog'
			);

		beforeEach( async () => {
			addSkill( agents(), 'changelog' );
			await setGlobalSkillEnabled( 'agents', 'changelog', true );
		} );

		it( "is added to Studio as a link, so it shows with Studio's skills and is always the latest", async () => {
			expect( fs.lstatSync( link() ).isSymbolicLink() ).toBe( true );
			expect( fs.realpathSync( link() ) ).toBe(
				fs.realpathSync( path.join( agents(), 'changelog' ) )
			);
			expect( await find( 'studio' ) ).toEqual( {
				id: 'changelog',
				displayName: 'Changelog',
				description: 'Use changelog.',
				enabled: true,
				source: 'studio',
				directory: link(),
				linked: true,
			} );
			expect( await find( 'agents' ) ).toMatchObject( { enabled: true } );
			expect( await names() ).toEqual( [ 'changelog' ] );

			addSkill( agents(), 'changelog', 'A newer description.' );
			expect( ( await readSkillsForAgent() )[ 0 ].description ).toBe( 'A newer description.' );
			// Adding it again changes nothing.
			await setGlobalSkillEnabled( 'agents', 'changelog', true );
			expect( await names() ).toEqual( [ 'changelog' ] );
		} );

		it( 'switches off and on in Studio like any skill, and stays added', async () => {
			await setGlobalSkillEnabled( 'studio', 'changelog', false );
			expect( await names() ).toEqual( [] );
			expect( await find( 'studio' ) ).toMatchObject( { enabled: false, linked: true } );
			expect( await find( 'agents' ) ).toMatchObject( { enabled: true } );

			await setGlobalSkillEnabled( 'studio', 'changelog', true );
			expect( await names() ).toEqual( [ 'changelog' ] );
		} );

		it.each( [
			[ 'taken out of Studio', () => setGlobalSkillEnabled( 'agents', 'changelog', false ) ],
			[
				'taken out while it is off',
				async () => {
					await setGlobalSkillEnabled( 'studio', 'changelog', false );
					await setGlobalSkillEnabled( 'agents', 'changelog', false );
				},
			],
		] )( 'loses only its link when it is %s', async ( _how, remove ) => {
			await remove();
			expect( await find( 'studio' ) ).toBeUndefined();
			expect( await find( 'agents' ) ).toMatchObject( { enabled: false } );
			expect( fs.readFileSync( original(), 'utf8' ) ).toContain( 'Steps for changelog.' );
		} );

		it( 'is changed where it is kept when it is changed in Studio', async () => {
			expect( ( await getGlobalSkillDetails( 'changelog' ) ).instructions ).toBe(
				'Steps for changelog.'
			);
			expect(
				await updateGlobalSkill(
					'changelog',
					{ name: 'Changelog', description: 'Changed.', instructions: 'New steps.' },
					[]
				)
			).toBe( 'changelog' );
			expect( fs.readFileSync( original(), 'utf8' ) ).toContain( 'New steps.' );
			expect( fs.lstatSync( link() ).isSymbolicLink() ).toBe( true );
		} );

		it( 'moves its folder, and the link with it, when it gets a new name in Studio', async () => {
			addSkill( agents(), 'pr-description' );
			await expect(
				updateGlobalSkill(
					'changelog',
					{ name: 'PR description', description: 'Changed.', instructions: 'Steps.' },
					[]
				)
			).rejects.toThrow( 'already exists' );

			await setGlobalSkillEnabled( 'studio', 'changelog', false );
			expect(
				await updateGlobalSkill(
					'changelog',
					{ name: 'Release notes', description: 'Changed.', instructions: 'Steps.' },
					[]
				)
			).toBe( 'release-notes' );
			expect( fs.existsSync( path.join( agents(), 'changelog' ) ) ).toBe( false );
			expect(
				fs.readFileSync( path.join( agents(), 'release-notes', 'SKILL.md' ), 'utf8' )
			).toContain( 'name: release-notes' );
			expect(
				( await getGlobalSkills() ).filter( ( skill ) => skill.id === 'release-notes' )
			).toEqual( [
				expect.objectContaining( { source: 'studio', linked: true, enabled: false } ),
				expect.objectContaining( { source: 'agents', enabled: true } ),
			] );
			expect( fs.existsSync( link() ) ).toBe( false );
		} );

		it( 'is deleted where it is kept when it is deleted in Studio', async () => {
			await removeGlobalSkill( 'changelog' );
			expect( await getGlobalSkills() ).toEqual( [] );
			expect( fs.existsSync( path.join( agents(), 'changelog' ) ) ).toBe( false );
			expect( fs.existsSync( agents() ) ).toBe( true );
		} );

		it( 'only loses its link on a delete when the link points outside ~/.agents/skills', async () => {
			const elsewhere = path.join( root, 'elsewhere' );
			addSkill( elsewhere, 'house-style' );
			fs.symlinkSync( path.join( elsewhere, 'house-style' ), path.join( studio(), 'house-style' ) );
			expect( await names() ).toEqual( [ 'changelog', 'house-style' ] );

			await removeGlobalSkill( 'house-style' );
			expect( await names() ).toEqual( [ 'changelog' ] );
			expect(
				fs.readFileSync( path.join( elsewhere, 'house-style', 'SKILL.md' ), 'utf8' )
			).toContain( 'Steps for house-style.' );
		} );

		it( "never takes the place of one of Studio's own", async () => {
			addSkill( agents(), 'brand-voice', 'Theirs.' );
			addSkill( studio(), 'brand-voice', 'Ours.' );
			await expect( setGlobalSkillEnabled( 'agents', 'brand-voice', true ) ).rejects.toThrow(
				'Studio already has a skill named “brand-voice”.'
			);
			await setGlobalSkillEnabled( 'agents', 'brand-voice', false );
			expect(
				fs.readFileSync( path.join( studio(), 'brand-voice', 'SKILL.md' ), 'utf8' )
			).toContain( 'Ours.' );
		} );

		it( 'can be added again after its folder was deleted and made again', async () => {
			fs.rmSync( path.join( agents(), 'changelog' ), { recursive: true } );
			expect( await getGlobalSkills() ).toEqual( [] );
			addSkill( agents(), 'changelog' );
			await setGlobalSkillEnabled( 'agents', 'changelog', true );
			expect( await names() ).toEqual( [ 'changelog' ] );
		} );
	} );

	describe( 'a link Studio did not make', () => {
		const elsewhere = () => path.join( root, 'elsewhere' );

		beforeEach( () => {
			addSkill( elsewhere(), 'house-style' );
			fs.mkdirSync( studio(), { recursive: true } );
			fs.symlinkSync( path.join( elsewhere(), 'house-style' ), path.join( studio(), 'brand' ) );
		} );

		it( 'is deleted when there is no ~/.agents/skills, and its folder stays', async () => {
			expect( fs.existsSync( agents() ) ).toBe( false );
			await removeGlobalSkill( 'brand' );
			expect( await getGlobalSkills() ).toEqual( [] );
			expect( fs.existsSync( path.join( elsewhere(), 'house-style', 'SKILL.md' ) ) ).toBe( true );
		} );

		it( 'still points at its folder after a save, when the two have different names', async () => {
			expect(
				await updateGlobalSkill(
					'brand',
					{ name: 'Brand', description: 'Write in the brand voice.', instructions: 'Steps.' },
					[]
				)
			).toBe( 'brand' );
			expect( await names() ).toEqual( [ 'brand' ] );
			expect( fs.realpathSync( path.join( studio(), 'brand' ) ) ).toBe(
				fs.realpathSync( path.join( elsewhere(), 'brand' ) )
			);
		} );
	} );

	it( "switches one of Studio's off by moving its folder, and deletes it", async () => {
		addSkill( studio(), 'brand-voice' );

		await setGlobalSkillEnabled( 'studio', 'brand-voice', false );
		expect( fs.existsSync( path.join( studio(), 'brand-voice' ) ) ).toBe( false );
		expect(
			fs.readFileSync(
				path.join( root, 'config', 'disabled-skills', 'brand-voice', 'SKILL.md' ),
				'utf8'
			)
		).toContain( 'Steps for brand-voice.' );
		expect( ( await getGlobalSkills() )[ 0 ] ).toMatchObject( {
			id: 'brand-voice',
			enabled: false,
		} );
		expect( await names() ).toEqual( [] );

		await setGlobalSkillEnabled( 'studio', 'brand-voice', true );
		expect( await names() ).toEqual( [ 'brand-voice' ] );

		await removeGlobalSkill( 'brand-voice' );
		expect( await getGlobalSkills() ).toEqual( [] );
	} );

	it( "refuses a skill it did not find, and never deletes another agent's", async () => {
		addSkill( agents(), 'changelog' );
		await expect( setGlobalSkillEnabled( 'studio', '../../home', false ) ).rejects.toThrow(
			'Unknown skill'
		);
		await expect( removeGlobalSkill( 'changelog' ) ).rejects.toThrow( 'Unknown skill' );
		expect( fs.existsSync( path.join( agents(), 'changelog' ) ) ).toBe( true );
	} );

	describe( 'on a site', () => {
		beforeEach( async () => {
			addSkill( studio(), 'brand-voice' );
			addSkill( studio(), 'launch-checklist' );
			addSkill( agents(), 'changelog' );
			addSkill( path.join( site, '.agents', 'skills' ), 'lookbook-post' );
			await setGlobalSkillEnabled( 'studio', 'launch-checklist', false );
		} );

		it( "lists the site's own skills, then the global ones that are on", async () => {
			expect(
				( await getSiteAgentFiles( site, 'skills' ) ).map( ( skill ) => [
					skill.id,
					skill.globalSource,
					skill.enabled,
				] )
			).toEqual( [
				[ 'lookbook-post', undefined, true ],
				[ 'brand-voice', 'studio', true ],
			] );
			expect( await names( site ) ).toEqual( [ 'lookbook-post', 'brand-voice' ] );
		} );

		it( 'never switches a global skill from a site: it is on or off for all sites', async () => {
			await expect(
				setSiteAgentFileEnabled( site, root, 'skills', 'brand-voice', false )
			).rejects.toThrow( 'Unknown skills file' );
			expect( await names( site ) ).toEqual( [ 'lookbook-post', 'brand-voice' ] );

			await setGlobalSkillEnabled( 'studio', 'brand-voice', false );
			expect( await names( site ) ).toEqual( [ 'lookbook-post' ] );
			expect( await names() ).toEqual( [] );
		} );

		it( 'never deletes a global skill from a site', async () => {
			await expect( removeSiteAgentFile( site, 'skills', 'brand-voice' ) ).rejects.toThrow(
				'Unknown skills file'
			);
			expect( fs.existsSync( path.join( studio(), 'brand-voice' ) ) ).toBe( true );
		} );

		it( "lets the site's skill take the place of a global one with its name, on or off", async () => {
			addSkill( path.join( site, '.agents', 'skills' ), 'brand-voice', 'The site voice.' );
			expect( await readSkillsForAgent( site ) ).toEqual( [
				{
					name: 'brand-voice',
					description: 'The site voice.',
					directory: path.join( site, '.agents', 'skills', 'brand-voice' ),
				},
				expect.objectContaining( { name: 'lookbook-post' } ),
			] );

			await setSiteAgentFileEnabled( site, root, 'skills', 'brand-voice', false );
			expect( await names( site ) ).toEqual( [ 'lookbook-post' ] );
			expect(
				( await getSiteAgentFiles( site, 'skills' ) )
					.filter( ( skill ) => skill.id === 'brand-voice' )
					.map( ( skill ) => [ skill.enabled, skill.globalSource ] )
			).toEqual( [ [ false, undefined ] ] );
		} );
	} );
} );
