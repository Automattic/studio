import fs from 'fs';
import os from 'os';
import path from 'path';
import { readSkillsForAgent } from '@studio/common/lib/global-skills';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadSkills } from '@studio/agent/node/skills';
import { resolveConversationTools, resolveExternalTools } from '@studio/agent/node/tools';
import { saveSkillTool } from '@studio/agent/node/tools/save-skill';
import { RESERVED_SKILL_NAMES } from '@studio/agent/protocol/reserved-skill-names';
import { getAiSkillCommands } from '@studio/agent/protocol/slash-commands';
import { createFakeHost, fakeSite } from './fake-host';

const skill = {
	name: 'Lookbook post',
	description: 'Lay out a seasonal lookbook post.',
	instructions: '# Lookbook post\n\n1. Ask for the season.',
};

describe( 'save_skill', () => {
	let root: string;
	let site: string;
	const save = async ( args: Record< string, unknown >, ui = false ) => {
		const host = { ...createFakeHost(), ...( ui ? { ui: {} } : {} ) };
		host.sites.resolve = async () => ( { ...fakeSite, name: 'Moiré Journal', path: site } );
		const result = await saveSkillTool.handler( args as never, { host } as never );
		return result.content.map( ( part ) => ( part.type === 'text' ? part.text : '' ) ).join( '' );
	};

	beforeEach( () => {
		root = fs.mkdtempSync( path.join( os.tmpdir(), 'studio-save-skill-' ) );
		site = path.join( root, 'site' );
		fs.mkdirSync( site );
		process.env.DEV_CONFIG_DIR = path.join( root, 'config' );
		vi.spyOn( os, 'homedir' ).mockReturnValue( path.join( root, 'home' ) );
	} );

	afterEach( () => {
		vi.restoreAllMocks();
		delete process.env.DEV_CONFIG_DIR;
		fs.rmSync( root, { recursive: true, force: true } );
	} );

	it( "saves a skill in the site's folder and says how the user runs it", async () => {
		const text = await save( { scope: 'site', nameOrPath: 'Moiré Journal', ...skill } );

		expect( text ).toContain( 'Saved the skill on Moiré Journal' );
		expect( text ).toContain( '/lookbook-post' );
		expect(
			fs.readFileSync( path.join( site, '.agents', 'skills', 'lookbook-post', 'SKILL.md' ), 'utf8' )
		).toContain( '1. Ask for the season.' );
	} );

	it( 'saves a skill for all sites in Studio', async () => {
		expect( await save( { scope: 'all_sites', ...skill } ) ).toContain(
			path.join( root, 'config', 'skills', 'lookbook-post' )
		);
		expect( await readSkillsForAgent() ).toEqual( [
			expect.objectContaining( { name: 'lookbook-post', description: skill.description } ),
		] );
	} );

	it( 'points to Settings only where a Studio UI is attached, otherwise to the file', async () => {
		expect( await save( { scope: 'all_sites', ...skill }, true ) ).toContain(
			'changes it in Settings → Skills'
		);
		const text = await save( { scope: 'site', nameOrPath: 'Moiré Journal', ...skill } );
		expect( text ).not.toContain( 'Settings' );
		expect( text ).toContain(
			`changes it by editing ${ path.join(
				site,
				'.agents',
				'skills',
				'lookbook-post',
				'SKILL.md'
			) }`
		);
	} );

	it( 'never replaces a skill, takes none of Studio’s names, and needs a site for a site skill', async () => {
		await save( { scope: 'all_sites', ...skill } );
		await expect( save( { scope: 'all_sites', ...skill } ) ).rejects.toThrow( 'already exists' );
		await expect( save( { scope: 'all_sites', ...skill, name: 'Build site' } ) ).rejects.toThrow(
			'Studio has its own skill'
		);
		await expect( save( { scope: 'site', ...skill } ) ).rejects.toThrow( 'Name the site' );
	} );
} );

describe( 'the create-skill skill', () => {
	it( "reserves the name of every skill of Studio's", () => {
		expect( RESERVED_SKILL_NAMES ).toEqual( loadSkills().map( ( { name } ) => name ) );
	} );

	it( 'is offered in the / menu, with save_skill in every conversation', () => {
		expect( getAiSkillCommands().map( ( command ) => command.name ) ).toContain( 'create-skill' );
		const tools = resolveConversationTools( createFakeHost(), { tracks: {} as never } );
		expect( tools.map( ( tool ) => tool.name ) ).toContain( 'save_skill' );
		expect( tools.find( ( tool ) => tool.name === 'Skill' )?.description ).toContain(
			'- create-skill:'
		);
	} );

	it( 'stays out of the instructions of an agent that has no save_skill', () => {
		const tools = resolveExternalTools( createFakeHost() );
		expect( tools.map( ( tool ) => tool.name ) ).not.toContain( 'save_skill' );
		expect(
			JSON.stringify( tools.find( ( tool ) => tool.name === 'studio_instructions' ) )
		).not.toContain( 'create-skill' );
	} );
} );
