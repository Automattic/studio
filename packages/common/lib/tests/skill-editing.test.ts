import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
	createSiteSkill,
	getBundledSkills,
	getSiteAgentFiles,
	getSiteSkillDetails,
	setSiteAgentFileEnabled,
	updateSiteSkill,
} from '../agent-skills';
import { getConfigPath } from '../config/store';
import {
	createGlobalSkill,
	getGlobalSkillDetails,
	getGlobalSkills,
	readSkillsForAgent,
	setGlobalSkillEnabled,
	updateGlobalSkill,
} from '../global-skills';
import { getSkillId, SHIPPED_SKILL_IDS } from '../skill-draft';

const draft = {
	name: 'Lookbook Post',
	description: 'Lay out a seasonal\nlookbook post.',
	instructions: '# Lookbook post\n\n1. Ask for the season.\n',
};
const RESERVED = [ 'build-site' ];

describe( 'making and changing skills', () => {
	let root: string;
	let site: string;
	const siteSkill = ( ...parts: string[] ) => path.join( site, '.agents', 'skills', ...parts );
	const read = ( file: string ) => fs.readFileSync( file, 'utf8' );

	beforeEach( () => {
		root = fs.mkdtempSync( path.join( os.tmpdir(), 'studio-skill-editing-' ) );
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

	it( 'knows the skills Studio copied into sites, which the / menu leaves out', () => {
		expect( SHIPPED_SKILL_IDS ).toEqual( getBundledSkills().map( ( skill ) => skill.id ) );
	} );

	it( 'makes the command from the name', () => {
		expect( getSkillId( '  Lookbook Post! ' ) ).toBe( 'lookbook-post' );
		expect( getSkillId( 'Café menu 2' ) ).toBe( 'cafe-menu-2' );
		expect( getSkillId( '日本語' ) ).toBe( '' );
	} );

	it( 'saves a new site skill that agents can load at once', async () => {
		expect( await createSiteSkill( site, draft, RESERVED ) ).toBe( 'lookbook-post' );

		expect( read( siteSkill( 'lookbook-post', 'SKILL.md' ) ) ).toBe(
			'---\nname: lookbook-post\ndescription: Lay out a seasonal lookbook post.\n---\n\n# Lookbook post\n\n1. Ask for the season.\n'
		);
		expect( await readSkillsForAgent( site ) ).toEqual( [
			{
				name: 'lookbook-post',
				description: 'Lay out a seasonal lookbook post.',
				directory: siteSkill( 'lookbook-post' ),
			},
		] );
		expect( await getSiteSkillDetails( site, 'lookbook-post' ) ).toEqual( {
			id: 'lookbook-post',
			displayName: 'Lookbook post',
			description: 'Lay out a seasonal lookbook post.',
			instructions: '# Lookbook post\n\n1. Ask for the season.',
			files: [ 'SKILL.md' ],
		} );
	} );

	it( 'refuses a draft that agents could not use, and never writes over a skill', async () => {
		await createSiteSkill( site, draft, RESERVED );
		const before = read( siteSkill( 'lookbook-post', 'SKILL.md' ) );

		await expect(
			createSiteSkill( site, { ...draft, instructions: 'Other steps.' }, RESERVED )
		).rejects.toThrow( 'A skill named “lookbook-post” already exists.' );
		expect( read( siteSkill( 'lookbook-post', 'SKILL.md' ) ) ).toBe( before );

		// A skill that is switched off still holds its name.
		await setSiteAgentFileEnabled( site, root, 'skills', 'lookbook-post', false );
		await expect( createSiteSkill( site, draft, RESERVED ) ).rejects.toThrow( 'already exists' );

		await expect(
			createSiteSkill( site, { ...draft, name: 'Build site' }, RESERVED )
		).rejects.toThrow( 'Studio has its own skill named “build-site”' );
		await expect( createSiteSkill( site, { ...draft, name: ' !! ' }, RESERVED ) ).rejects.toThrow(
			'Give the skill a name'
		);
		await expect(
			createSiteSkill( site, { ...draft, name: 'Other', description: '  ' }, RESERVED )
		).rejects.toThrow( 'Say when agents should use the skill.' );
		await expect(
			createSiteSkill( site, { ...draft, name: 'Other', instructions: '' }, RESERVED )
		).rejects.toThrow( 'Write the instructions' );
		await expect(
			createSiteSkill(
				site,
				{ ...draft, name: 'Other', instructions: 'x'.repeat( 20001 ) },
				RESERVED
			)
		).rejects.toThrow( 'The instructions are too long.' );
		expect( fs.existsSync( siteSkill( 'other' ) ) ).toBe( false );
	} );

	it( 'saves changes to a skill and keeps its other files and frontmatter', async () => {
		fs.mkdirSync( siteSkill( 'lookbook-post', 'references' ), { recursive: true } );
		fs.writeFileSync( siteSkill( 'lookbook-post', 'references', 'credits.md' ), 'Credits.' );
		fs.writeFileSync( siteSkill( 'lookbook-post', '.DS_Store' ), '' );
		fs.writeFileSync(
			siteSkill( 'lookbook-post', 'SKILL.md' ),
			'---\nname: lookbook-post\ndescription: Old.\nlicense: MIT\n---\nOld steps.'
		);

		expect( ( await getSiteSkillDetails( site, 'lookbook-post' ) ).files ).toEqual( [
			'SKILL.md',
			'references/credits.md',
		] );
		expect(
			await updateSiteSkill(
				site,
				'lookbook-post',
				{ name: 'Lookbook post', description: 'New: with a colon.', instructions: 'New steps.' },
				RESERVED
			)
		).toBe( 'lookbook-post' );
		expect( read( siteSkill( 'lookbook-post', 'SKILL.md' ) ) ).toBe(
			'---\nname: lookbook-post\ndescription: "New: with a colon."\nlicense: MIT\n---\n\nNew steps.\n'
		);
		expect( ( await readSkillsForAgent( site ) )[ 0 ].description ).toBe( 'New: with a colon.' );
	} );

	it( 'keeps the other keys of a SKILL.md that YAML cannot read', async () => {
		fs.mkdirSync( siteSkill( 'lookbook-post' ), { recursive: true } );
		fs.writeFileSync(
			siteSkill( 'lookbook-post', 'SKILL.md' ),
			'---\nname: lookbook-post\ndescription: Use when: a season starts\n  or ends\nallowed-tools: Bash\n---\nOld steps.'
		);
		expect( ( await getSiteSkillDetails( site, 'lookbook-post' ) ).description ).toBe( '' );

		await updateSiteSkill(
			site,
			'lookbook-post',
			{ name: 'Lookbook post', description: 'Lay out a post.', instructions: 'New steps.' },
			RESERVED
		);
		expect( read( siteSkill( 'lookbook-post', 'SKILL.md' ) ) ).toBe(
			'---\nallowed-tools: Bash\nname: lookbook-post\ndescription: Lay out a post.\n---\n\nNew steps.\n'
		);
	} );

	it( 'keeps the names of the WordPress skills Studio ships for those skills', async () => {
		await expect(
			createSiteSkill( site, { ...draft, name: 'WP REST API' }, RESERVED )
		).rejects.toThrow( 'Studio has its own skill named “wp-rest-api”' );

		// A shipped skill the site has can still be changed under its name.
		fs.mkdirSync( siteSkill( 'studio-cli' ), { recursive: true } );
		fs.writeFileSync( siteSkill( 'studio-cli', 'SKILL.md' ), '---\ndescription: Old.\n---\nOld.' );
		expect(
			await updateSiteSkill( site, 'studio-cli', { ...draft, name: 'Studio CLI' }, RESERVED )
		).toBe( 'studio-cli' );
		await expect(
			updateSiteSkill( site, 'studio-cli', { ...draft, name: 'WP REST API' }, RESERVED )
		).rejects.toThrow( 'Studio has its own skill named “wp-rest-api”' );
	} );

	it( 'changes nothing when the folder of a new name is taken or can not be made', async () => {
		await createSiteSkill( site, draft, RESERVED );
		const before = read( siteSkill( 'lookbook-post', 'SKILL.md' ) );
		// A folder without a SKILL.md is not a skill, but its name is not free.
		fs.mkdirSync( siteSkill( 'notes' ) );
		fs.writeFileSync( siteSkill( 'notes', 'todo.md' ), '' );

		await expect(
			updateSiteSkill( site, 'lookbook-post', { ...draft, name: 'Notes' }, RESERVED )
		).rejects.toThrow( 'A skill named “notes” already exists.' );
		expect( read( siteSkill( 'lookbook-post', 'SKILL.md' ) ) ).toBe( before );

		const mkdir = fs.promises.mkdir;
		vi.spyOn( fs.promises, 'mkdir' ).mockImplementation( async ( target, options ) => {
			if ( String( target ).endsWith( 'size-guide' ) ) {
				throw Object.assign( new Error( 'EACCES: permission denied' ), { code: 'EACCES' } );
			}
			return mkdir( target, options );
		} );
		await expect(
			createSiteSkill( site, { ...draft, name: 'Size guide' }, RESERVED )
		).rejects.toThrow( 'EACCES' );
	} );

	it( 'moves the folder when the name changes, where the skill is, on or off', async () => {
		await createSiteSkill( site, draft, RESERVED );
		await createSiteSkill( site, { ...draft, name: 'Size guide' }, RESERVED );

		await expect(
			updateSiteSkill( site, 'lookbook-post', { ...draft, name: 'Size guide' }, RESERVED )
		).rejects.toThrow( 'already exists' );
		await expect( updateSiteSkill( site, '../site', draft, RESERVED ) ).rejects.toThrow(
			'Unknown skill'
		);

		await setSiteAgentFileEnabled( site, root, 'skills', 'lookbook-post', false );
		expect(
			await updateSiteSkill( site, 'lookbook-post', { ...draft, name: 'Season post' }, RESERVED )
		).toBe( 'season-post' );
		expect(
			( await getSiteAgentFiles( site, 'skills' ) ).map( ( skill ) => [ skill.id, skill.enabled ] )
		).toEqual( [
			[ 'season-post', false ],
			[ 'size-guide', true ],
		] );
		expect(
			read( path.join( site, '.agents', 'disabled-skills', 'season-post', 'SKILL.md' ) )
		).toContain( 'name: season-post' );
	} );

	it( 'points the Claude Code link at the new folder after a new name', async () => {
		await createSiteSkill( site, draft, RESERVED );
		fs.mkdirSync( path.join( site, '.claude', 'skills' ), { recursive: true } );
		fs.symlinkSync(
			path.join( '..', '..', '.agents', 'skills', 'lookbook-post' ),
			path.join( site, '.claude', 'skills', 'lookbook-post' )
		);

		await updateSiteSkill( site, 'lookbook-post', { ...draft, name: 'Season post' }, RESERVED );

		expect( fs.existsSync( path.join( site, '.claude', 'skills', 'lookbook-post' ) ) ).toBe(
			false
		);
		expect( read( path.join( site, '.claude', 'skills', 'season-post', 'SKILL.md' ) ) ).toContain(
			'name: season-post'
		);
	} );

	it( "makes and changes Studio's skills for all sites, and leaves the other agents' alone", async () => {
		const agents = path.join( root, 'home', '.agents', 'skills', 'changelog' );
		fs.mkdirSync( agents, { recursive: true } );
		fs.writeFileSync( path.join( agents, 'SKILL.md' ), '---\ndescription: Log.\n---\nSteps.' );

		expect( await createGlobalSkill( { ...draft, name: 'Brand voice' }, RESERVED ) ).toBe(
			'brand-voice'
		);
		// Studio's own may share a name with another agent's: Studio's comes first.
		expect( await createGlobalSkill( { ...draft, name: 'Changelog' }, RESERVED ) ).toBe(
			'changelog'
		);
		await expect(
			createGlobalSkill( { ...draft, name: 'Brand voice' }, RESERVED )
		).rejects.toThrow( 'already exists' );
		expect( await readSkillsForAgent( site ) ).toEqual( [
			expect.objectContaining( { name: 'brand-voice' } ),
			expect.objectContaining( {
				name: 'changelog',
				directory: path.join( root, 'config', 'skills', 'changelog' ),
			} ),
		] );

		await setGlobalSkillEnabled( 'studio', 'brand-voice', false );
		expect(
			await updateGlobalSkill( 'brand-voice', { ...draft, name: 'House voice' }, RESERVED )
		).toBe( 'house-voice' );
		expect( ( await getGlobalSkillDetails( 'house-voice' ) ).instructions ).toContain(
			'Ask for the season.'
		);
		expect(
			( await getGlobalSkills() ).find( ( skill ) => skill.id === 'house-voice' )
		).toMatchObject( { source: 'studio', enabled: false } );
		expect( read( path.join( agents, 'SKILL.md' ) ) ).toContain( 'Log.' );
	} );
} );
