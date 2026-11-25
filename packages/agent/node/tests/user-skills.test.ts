import { mkdir, mkdtemp, rm, writeFile } from 'fs/promises';
import os from 'os';
import path from 'path';
import { readSiteSkills, type UserSkill } from '@studio/common/lib/user-skills';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createSkillTool } from '@studio/agent/node/tools/skill';
import type { StudioToolDefinition } from '@studio/agent/node/tools/define-tool';

describe( 'site skills in the Skill tool', () => {
	let sitePath: string;

	const addSkill = async ( name: string, contents: string ) => {
		const directory = path.join( sitePath, '.agents', 'skills', name );
		await mkdir( directory, { recursive: true } );
		await writeFile( path.join( directory, 'SKILL.md' ), contents );
		return directory;
	};
	const loadSkill = async ( tool: StudioToolDefinition | null, name: string ) => {
		const result = await tool!.handler( { name } as never, {} as never );
		return result.content.map( ( part ) => ( part.type === 'text' ? part.text : '' ) ).join( '' );
	};

	beforeEach( async () => {
		sitePath = await mkdtemp( path.join( os.tmpdir(), 'studio-site-skills-' ) );
	} );

	afterEach( async () => {
		await rm( sitePath, { recursive: true, force: true } );
	} );

	it( 'lists the site skills with a description and loads their latest instructions', async () => {
		const directory = await addSkill(
			'lookbook-post',
			'---\ndescription: Lay out a lookbook post.\n---\nAsk for the season.'
		);
		await addSkill( 'size-guide', '# No description' );
		const tool = createSkillTool( [], await readSiteSkills( sitePath ) );

		expect( tool?.description ).toContain( '- lookbook-post: Lay out a lookbook post.' );
		expect( tool?.description ).not.toContain( 'size-guide' );
		expect( await loadSkill( tool, 'lookbook-post' ) ).toContain( 'Ask for the season.' );
		expect( await loadSkill( tool, 'lookbook-post' ) ).toContain( directory );

		await addSkill(
			'lookbook-post',
			'---\ndescription: Lay out a lookbook post.\n---\nAsk for the photo folder.'
		);
		expect( await loadSkill( tool, 'lookbook-post' ) ).toContain( 'Ask for the photo folder.' );
	} );

	it( "keeps Studio's skill when a site skill has the same name", async () => {
		const own: UserSkill = {
			name: 'build-site',
			description: 'A site skill with a reserved name.',
			directory: await addSkill( 'build-site', '---\ndescription: x\n---\nSITE-SKILL-BODY' ),
		};
		const tool = createSkillTool( [], [ own ] );

		expect( tool?.description ).not.toContain( own.description );
		expect( await loadSkill( tool, 'build-site' ) ).not.toContain( 'SITE-SKILL-BODY' );
	} );

	it( 'tells the app which skill it loaded, apart from the instructions', async () => {
		await addSkill(
			'lookbook-post',
			'---\ndescription: Lay out a lookbook post.\n---\nAsk for the season.'
		);
		const tool = createSkillTool( [], await readSiteSkills( sitePath ) );
		const details = async ( name: string ) =>
			( await tool!.handler( { name } as never, {} as never ) ).details;

		expect( await details( 'lookbook-post' ) ).toEqual( {
			skill: { name: 'lookbook-post', description: 'Lay out a lookbook post.' },
		} );
		expect( await details( 'build-site' ) ).toEqual( {
			skill: { name: 'build-site', description: expect.stringMatching( /\S/ ) },
		} );
	} );

	it( 'says nothing about user skills when the site has none', () => {
		expect( createSkillTool()?.description ).not.toContain( "user's own skills" );
	} );
} );
