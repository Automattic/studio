import { mkdir, mkdtemp, rm, writeFile } from 'fs/promises';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readSiteSkills, readUserSkillInstructions } from '../user-skills';

describe( 'site skills', () => {
	let sitePath: string;

	const addSkill = async ( name: string, contents: string, file = 'SKILL.md' ) => {
		const directory = path.join( sitePath, '.agents', 'skills', name );
		await mkdir( directory, { recursive: true } );
		await writeFile( path.join( directory, file ), contents );
		return directory;
	};

	beforeEach( async () => {
		sitePath = await mkdtemp( path.join( os.tmpdir(), 'studio-site-skills-' ) );
	} );

	afterEach( async () => {
		await rm( sitePath, { recursive: true, force: true } );
	} );

	it( 'has none for a site without a skills folder', async () => {
		expect( await readSiteSkills( sitePath ) ).toEqual( [] );
	} );

	it( 'reads each skill folder with a SKILL.md, by folder name', async () => {
		const directory = await addSkill(
			'lookbook-post',
			'---\nname: Lookbook post\ndescription: >\n  Lay out a seasonal\n  lookbook post.\n---\n\n# Lookbook post\n\nAsk for the season.\n'
		);
		await addSkill( 'brand-voice', '---\ndescription: "Write in the house voice."\n---\nBe warm.' );
		await addSkill( 'notes', 'No skill here.', 'README.md' );
		await addSkill( 'Not A Skill', '---\ndescription: A bad folder name.\n---\n' );

		const skills = await readSiteSkills( sitePath );

		expect( skills ).toEqual( [
			{
				name: 'brand-voice',
				description: 'Write in the house voice.',
				directory: path.join( sitePath, '.agents', 'skills', 'brand-voice' ),
			},
			{ name: 'lookbook-post', description: 'Lay out a seasonal lookbook post.', directory },
		] );
		expect( await readUserSkillInstructions( skills[ 1 ] ) ).toBe(
			'# Lookbook post\n\nAsk for the season.'
		);
	} );

	it( 'keeps a skill whose SKILL.md states no description, with an empty one', async () => {
		await addSkill( 'size-guide', '# Size guide\n\nUse the size table.' );
		await addSkill( 'broken', '---\ndescription: [unclosed\n---\nBody.' );

		const skills = await readSiteSkills( sitePath );

		expect( skills.map( ( { name, description } ) => [ name, description ] ) ).toEqual( [
			[ 'broken', '' ],
			[ 'size-guide', '' ],
		] );
		expect( await readUserSkillInstructions( skills[ 1 ] ) ).toBe(
			'# Size guide\n\nUse the size table.'
		);
	} );

	it( 'does not leave the switched-off skills where agents find them', async () => {
		const disabled = path.join( sitePath, '.agents', 'disabled-skills', 'old-skill' );
		await mkdir( disabled, { recursive: true } );
		await writeFile( path.join( disabled, 'SKILL.md' ), '---\ndescription: Off.\n---\n' );

		expect( await readSiteSkills( sitePath ) ).toEqual( [] );
	} );
} );
