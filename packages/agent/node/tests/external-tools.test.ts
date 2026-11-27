import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import os, { tmpdir } from 'os';
import path from 'path';
import { setGlobalSkillEnabled } from '@studio/common/lib/global-skills';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadSkills } from '@studio/agent/node/skills';
import { resolveExternalTools } from '@studio/agent/node/tools';
import { createFakeHost, fakeSite } from './fake-host';

describe( 'resolveExternalTools', () => {
	it( 'leads with studio_instructions and includes present_design_options', () => {
		const names = resolveExternalTools( createFakeHost() ).map( ( tool ) => tool.name );
		expect( names[ 0 ] ).toBe( 'studio_instructions' );
		expect( names ).toContain( 'present_design_options' );
	} );

	it( 'adds the declared settings of the core blocks a result shows, from the site the call names, once', async () => {
		const sitePath = path.join( mkdtempSync( path.join( tmpdir(), 'external-tools-' ) ), 'site' );
		const blockJson = path.join( sitePath, 'wp-includes', 'blocks', 'navigation', 'block.json' );
		mkdirSync( path.dirname( blockJson ), { recursive: true } );
		writeFileSync(
			blockJson,
			JSON.stringify( { attributes: { submenuVisibility: { enum: [ 'hover', 'click' ] } } } )
		);
		const host = createFakeHost();
		host.sites.resolve = vi.fn( async ( name: string ) => {
			if ( name !== 'My Site' ) {
				throw new Error( 'Site not found' );
			}
			return { ...fakeSite, path: sitePath };
		} );
		host.sites.wpCli = vi.fn( async () => ( {
			exitCode: 0,
			stdout: '<!-- wp:navigation /-->',
			stderr: '',
		} ) );
		const wpCli = resolveExternalTools( host ).find( ( tool ) => tool.name === 'wp_cli' )!;
		const notes = async ( nameOrPath: string ) =>
			( await wpCli.rawHandler( { nameOrPath, command: 'post list' } as never ) ).content
				.slice( 1 )
				.map( ( part ) => ( part.type === 'text' ? part.text : '' ) );

		await expect( notes( 'Missing Site' ) ).rejects.toThrow();
		expect( await notes( 'My Site' ) ).toEqual( [
			`core/navigation settings, declared in ${ blockJson
				.split( path.sep )
				.join( '/' ) }: submenuVisibility ("hover"|"click").`,
		] );
		// Once per connection, as once per Studio Code turn.
		expect( await notes( 'My Site' ) ).toEqual( [] );
	} );
} );

describe( "the user's skills over studio_instructions", () => {
	let root: string;
	const addSkill = ( folder: string, name: string, contents: string ) => {
		mkdirSync( path.join( folder, name ), { recursive: true } );
		writeFileSync( path.join( folder, name, 'SKILL.md' ), contents );
	};
	const studio = () => path.join( root, 'config', 'skills' );
	const agents = () => path.join( root, 'home', '.agents', 'skills' );
	const instructionsTool = ( user?: string[], studio: string[] = [] ) =>
		resolveExternalTools( createFakeHost(), {
			hostSkills: user && { studio, user: async () => user },
		} ).find( ( candidate ) => candidate.name === 'studio_instructions' )!;
	const instructions = async (
		args: Record< string, string > = {},
		user?: string[],
		studio?: string[]
	) => {
		const result = await instructionsTool( user, studio ).rawHandler( args as never );
		return result.content.map( ( part ) => ( part.type === 'text' ? part.text : '' ) ).join( '' );
	};

	beforeEach( () => {
		root = mkdtempSync( path.join( tmpdir(), 'studio-mcp-skills-' ) );
		process.env.DEV_CONFIG_DIR = path.join( root, 'config' );
		vi.spyOn( os, 'homedir' ).mockReturnValue( path.join( root, 'home' ) );
	} );

	afterEach( () => {
		vi.restoreAllMocks();
		delete process.env.DEV_CONFIG_DIR;
		rmSync( root, { recursive: true, force: true } );
	} );

	it( 'says nothing about them when the user has none', async () => {
		expect( await instructions() ).not.toContain( "The user's own skills" );
	} );

	it( 'lists the skills for all sites that are on, and loads one with its folder', async () => {
		addSkill(
			studio(),
			'brand-voice',
			'---\ndescription: Write in the house voice.\n---\nBe warm.'
		);
		addSkill( studio(), 'client-handoff', '---\ndescription: Write handoff notes.\n---\nSteps.' );
		addSkill( studio(), 'no-description', '# Nothing to pick it by' );
		addSkill( studio(), 'build-site', '---\ndescription: A reserved name.\n---\nOWN-BUILD-SITE' );
		addSkill( agents(), 'changelog', '---\ndescription: Write a changelog.\n---\nLog it.' );
		addSkill( agents(), 'pr-description', '---\ndescription: Describe a PR.\n---\nDiff.' );
		await setGlobalSkillEnabled( 'studio', 'client-handoff', false );
		await setGlobalSkillEnabled( 'agents', 'changelog', true );

		const prompt = await instructions();
		expect( prompt ).toContain(
			"## The user's own skills\n\nThe user saved these skills in Studio, for all their sites."
		);
		expect( prompt ).toContain( '`user_skill` set to its name' );
		expect( prompt ).toContain(
			'- brand-voice: Write in the house voice.\n- changelog: Write a changelog.'
		);
		for ( const hidden of [ 'client-handoff', 'no-description', 'pr-description', 'reserved' ] ) {
			expect( prompt ).not.toContain( hidden );
		}

		const loaded = await instructions( { user_skill: 'brand-voice' } );
		expect( loaded ).toContain( 'Be warm.' );
		expect( loaded ).toContain( path.join( studio(), 'brand-voice' ) );
		expect( await instructions( { skill: 'build-site' } ) ).not.toContain( 'OWN-BUILD-SITE' );
	} );

	it( 'reads the skills again on every call', async () => {
		expect( await instructions() ).not.toContain( 'brand-voice' );
		addSkill(
			studio(),
			'brand-voice',
			'---\ndescription: Write in the house voice.\n---\nBe warm.'
		);
		expect( await instructions() ).toContain( '- brand-voice: Write in the house voice.' );
		addSkill(
			studio(),
			'brand-voice',
			'---\ndescription: Write in the house voice.\n---\nBe plain.'
		);
		expect( await instructions( { user_skill: 'brand-voice' } ) ).toContain( 'Be plain.' );
	} );

	it( 'leaves out the skills the host loads itself, and still loads them on request', async () => {
		addSkill(
			studio(),
			'brand-voice',
			'---\ndescription: Write in the house voice.\n---\nBe warm.'
		);
		addSkill( studio(), 'client-handoff', '---\ndescription: Write handoff notes.\n---\nSteps.' );

		const prompt = await instructions( {}, [ 'brand-voice' ] );
		expect( prompt ).toContain( '- client-handoff: Write handoff notes.' );
		expect( prompt ).not.toContain( 'brand-voice' );
		expect( await instructions( { user_skill: 'brand-voice' }, [ 'brand-voice' ] ) ).toContain(
			'Be warm.'
		);

		expect( await instructions( {}, [ 'brand-voice', 'client-handoff' ] ) ).not.toContain(
			"The user's own skills"
		);
	} );

	it( "lists Studio's skills for what users ask directly, but not the ones the host offers itself", async () => {
		const direct = loadSkills().filter( ( skill ) => skill.userInvokable );
		expect( instructionsTool().description ).toContain(
			`The skills for what users ask directly:\n- ${ direct[ 0 ].name }: `
		);
		expect( await instructions() ).not.toContain( 'skills of its own' );

		const offered = [ 'build-site', 'edit-manage-site' ];
		const description = instructionsTool( [], offered ).description;
		expect( description ).toContain( '- rank-me-up: ' );
		expect( description ).not.toContain( '- build-site: ' );
		const prompt = await instructions( {}, [], offered );
		expect( prompt ).toContain(
			'Your app offers these as skills of its own, so load them there instead: `build-site`, `edit-manage-site`.'
		);
		expect( await instructions( { skill: 'build-site' }, [], offered ) ).toContain( 'Site Spec' );

		expect(
			instructionsTool(
				[],
				direct.map( ( skill ) => skill.name )
			).description
		).not.toContain( 'The skills for what users ask directly' );
	} );

	it( 'names the skills the user has when asked for one they do not have', async () => {
		addSkill(
			studio(),
			'brand-voice',
			'---\ndescription: Write in the house voice.\n---\nBe warm.'
		);
		await expect( instructions( { user_skill: '../../secrets' } ) ).rejects.toThrow(
			'The user has no skill named "../../secrets". Their skills: brand-voice.'
		);
		await expect( instructions( { user_skill: 'client-handoff' } ) ).rejects.toThrow(
			'Their skills: brand-voice.'
		);
	} );
} );
