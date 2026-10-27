import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SkillToolScope } from '../runtimes/pi/skill-tool-scope';
import { createSkillTool } from '../tools/skill';
import type { SessionManager } from '@earendil-works/pi-coding-agent';

const emptySession = {
	buildSessionContext: () => ( { messages: [] } ),
} as unknown as SessionManager;

function textOf( result: { content: Array< { type: string; text?: string } > } ): string {
	return result.content.map( ( part ) => part.text ?? '' ).join( '' );
}

describe( "the user's own skills", () => {
	// os.homedir() reads HOME, or USERPROFILE on Windows.
	const homeVariable = process.platform === 'win32' ? 'USERPROFILE' : 'HOME';
	const originalHome = process.env[ homeVariable ];
	let home: string;

	beforeEach( () => {
		home = fs.mkdtempSync( path.join( os.tmpdir(), 'user-skills-' ) );
		process.env[ homeVariable ] = home;
	} );

	afterEach( () => {
		process.env[ homeVariable ] = originalHome;
		fs.rmSync( home, { recursive: true, force: true } );
	} );

	function addSkill( folder: string, frontmatter: string, body: string ): string {
		const dir = path.join( home, '.agents', 'skills', folder );
		fs.mkdirSync( dir, { recursive: true } );
		fs.writeFileSync( path.join( dir, 'SKILL.md' ), `---\n${ frontmatter }\n---\n${ body }\n` );
		return dir;
	}

	it( 'lists and loads a skill from ~/.agents/skills, with its folder and the Studio tools it names', async () => {
		const dir = addSkill(
			'launch-checklist',
			'name: launch-checklist\ndescription: Checks a site before launch\ntools: need_for_speed, Read',
			'Run the speed check, then read checklist.md.'
		);
		const tool = createSkillTool()!;
		expect( tool.description ).toContain(
			'- launch-checklist: Checks a site before launch (brings need_for_speed, Read)'
		);
		const loaded = textOf( await tool.execute( 'call', { name: 'launch-checklist' } as never ) );
		expect( loaded ).toContain( 'Run the speed check, then read checklist.md.' );
		expect( loaded ).toContain( `The skill's folder: ${ dir }` );
		expect( loaded ).toContain( 'Now available: need_for_speed, Read.' );

		const scope = new SkillToolScope( emptySession );
		expect( scope.activeToolNames( [ 'need_for_speed', 'Read' ] ) ).toEqual( [ 'Read' ] );
		scope.unlock( 'launch-checklist' );
		expect( scope.activeToolNames( [ 'need_for_speed', 'Read' ] ) ).toEqual( [
			'need_for_speed',
			'Read',
		] );
	} );

	it( 'keeps a Studio skill whose name a user skill reuses, and names the folder left out', async () => {
		const dir = addSkill( 'mine', 'name: taxonomist\ndescription: Mine', 'My version.' );
		const tool = createSkillTool()!;
		expect( tool.description ).toContain(
			`Not loaded, since a Studio skill has the same name: ${ dir }`
		);
		expect( tool.description ).not.toContain( '- taxonomist: Mine' );
		const loaded = textOf( await tool.execute( 'call', { name: 'taxonomist' } as never ) );
		expect( loaded ).not.toContain( 'My version.' );
		expect( loaded ).not.toContain( "The skill's folder" );
	} );
} );
