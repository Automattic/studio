import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getSiteAgentFiles, removeSiteAgentFile, setSiteAgentFileEnabled } from '../agent-skills';
import { getConfigPath, readConfig } from '../config/store';
import {
	getGlobalSkills,
	readSkillsForAgent,
	removeGlobalSkill,
	setGlobalSkillEnabled,
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

		await setGlobalSkillEnabled( 'agents', 'changelog', true );
		expect( await names() ).toEqual( [ 'brand-voice', 'changelog' ] );
		expect( fs.existsSync( path.join( agents(), 'changelog', 'SKILL.md' ) ) ).toBe( true );

		await setGlobalSkillEnabled( 'agents', 'changelog', false );
		expect( await names() ).toEqual( [ 'brand-voice' ] );
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

		it( 'switches a global skill off for this site only, and keeps its files', async () => {
			await setSiteAgentFileEnabled( site, root, 'skills', 'brand-voice', false );

			expect( ( await readConfig() ).sites[ 0 ].disabledGlobalSkills ).toEqual( [ 'brand-voice' ] );
			expect( await names( site ) ).toEqual( [ 'lookbook-post' ] );
			expect( await names() ).toEqual( [ 'brand-voice' ] );
			expect( fs.existsSync( path.join( studio(), 'brand-voice', 'SKILL.md' ) ) ).toBe( true );
			expect(
				( await getSiteAgentFiles( site, 'skills' ) ).find(
					( skill ) => skill.id === 'brand-voice'
				)
			).toMatchObject( { enabled: false, globalSource: 'studio' } );

			await setSiteAgentFileEnabled( site, root, 'skills', 'brand-voice', true );
			expect( await names( site ) ).toEqual( [ 'lookbook-post', 'brand-voice' ] );
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
