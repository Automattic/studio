import { createHash } from 'crypto';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'fs';
import os, { tmpdir } from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
	getServedSkill,
	listServedSkills,
	readServedSkillFile,
} from 'cli/ai/runtimes/mcp/user-skills';

describe( "the user's skills over the MCP Skills extension", () => {
	let root: string;
	const studio = () => path.join( root, 'config', 'skills' );
	const agents = () => path.join( root, 'home', '.agents', 'skills' );
	const addFile = ( folder: string, file: string, contents: string | Uint8Array ) => {
		mkdirSync( path.dirname( path.join( folder, file ) ), { recursive: true } );
		writeFileSync( path.join( folder, file ), contents );
	};
	const skillFile = ( name: string, description: string, body: string ) =>
		`---\nname: ${ name }\ndescription: ${ description }\n---\n\n${ body }\n`;
	const names = async () => ( await listServedSkills() ).map( ( skill ) => skill.frontmatter.name );

	beforeEach( () => {
		root = mkdtempSync( path.join( tmpdir(), 'studio-mcp-served-skills-' ) );
		process.env.DEV_CONFIG_DIR = path.join( root, 'config' );
		vi.spyOn( os, 'homedir' ).mockReturnValue( path.join( root, 'home' ) );
	} );

	afterEach( () => {
		vi.restoreAllMocks();
		delete process.env.DEV_CONFIG_DIR;
		rmSync( root, { recursive: true, force: true } );
	} );

	it( 'serves no skills when the user has none', async () => {
		expect( await listServedSkills() ).toEqual( [] );
	} );

	it( 'lists a skill with the size and digest of each of its files', async () => {
		const contents = skillFile( 'brand-voice', 'Write in the house voice.', 'Be warm.' );
		addFile( studio(), 'brand-voice/SKILL.md', contents );
		addFile( studio(), 'brand-voice/references/tone.md', '# Tone\n' );

		expect( await listServedSkills() ).toEqual( [
			{
				uri: 'skill://brand-voice/SKILL.md',
				frontmatter: { name: 'brand-voice', description: 'Write in the house voice.' },
				resources: [
					{
						uri: 'skill://brand-voice/SKILL.md',
						digest: `sha256:${ createHash( 'sha256' ).update( contents ).digest( 'hex' ) }`,
						size: Buffer.byteLength( contents ),
					},
					{
						uri: 'skill://brand-voice/references/tone.md',
						digest: `sha256:${ createHash( 'sha256' ).update( '# Tone\n' ).digest( 'hex' ) }`,
						size: 7,
					},
				],
			},
		] );
		expect( await getServedSkill( 'skill://brand-voice/SKILL.md' ) ).toMatchObject( {
			uri: 'skill://brand-voice/SKILL.md',
		} );
	} );

	it( 'serves the skills for all sites that are on, and reads them again on every call', async () => {
		addFile(
			studio(),
			'brand-voice/SKILL.md',
			skillFile( 'brand-voice', 'House voice.', 'Warm.' )
		);
		addFile(
			path.join( root, 'config', 'disabled-skills' ),
			'client-handoff/SKILL.md',
			skillFile( 'client-handoff', 'Handoff notes.', 'Steps.' )
		);
		expect( await names() ).toEqual( [ 'brand-voice' ] );

		addFile(
			studio(),
			'changelog/SKILL.md',
			skillFile( 'changelog', 'Write a changelog.', 'Log.' )
		);
		expect( await names() ).toEqual( [ 'brand-voice', 'changelog' ] );
	} );

	it( 'serves a skill linked from the folder of the other agents', async () => {
		addFile(
			agents(),
			'changelog/SKILL.md',
			skillFile( 'changelog', 'Write a changelog.', 'Log.' )
		);
		mkdirSync( studio(), { recursive: true } );
		symlinkSync( path.join( agents(), 'changelog' ), path.join( studio(), 'changelog' ) );

		expect( await names() ).toEqual( [ 'changelog' ] );
		expect( await readServedSkillFile( 'skill://changelog/SKILL.md' ) ).toEqual( {
			text: skillFile( 'changelog', 'Write a changelog.', 'Log.' ),
			mimeType: 'text/markdown',
		} );
	} );

	it( "leaves out the skills a host would refuse, and Studio's own names", async () => {
		addFile(
			studio(),
			'renamed/SKILL.md',
			skillFile( 'another-name', 'Not its folder.', 'Body.' )
		);
		addFile( studio(), 'no-name/SKILL.md', '---\ndescription: States no name.\n---\nBody.' );
		addFile( studio(), 'no-description/SKILL.md', '# Nothing to pick it by' );
		addFile( studio(), 'build-site/SKILL.md', skillFile( 'build-site', 'Reserved.', 'Body.' ) );

		expect( await listServedSkills() ).toEqual( [] );
		for ( const name of [ 'renamed', 'no-name', 'no-description', 'build-site' ] ) {
			expect( await getServedSkill( `skill://${ name }/SKILL.md` ) ).toBeUndefined();
			expect( await readServedSkillFile( `skill://${ name }/SKILL.md` ) ).toBeUndefined();
		}
	} );

	it( 'reads text as text and other files as bytes', async () => {
		addFile(
			studio(),
			'brand-voice/SKILL.md',
			skillFile( 'brand-voice', 'House voice.', 'Warm.' )
		);
		addFile( studio(), 'brand-voice/scripts/check.sh', 'echo ok\n' );
		addFile( studio(), 'brand-voice/assets/logo.bin', new Uint8Array( [ 0xff, 0xfe, 0x00 ] ) );

		expect( await readServedSkillFile( 'skill://brand-voice/scripts/check.sh' ) ).toEqual( {
			text: 'echo ok\n',
		} );
		expect( await readServedSkillFile( 'skill://brand-voice/assets/logo.bin' ) ).toEqual( {
			bytes: Buffer.from( [ 0xff, 0xfe, 0x00 ] ),
		} );
	} );

	it( 'reads only the files a skill lists', async () => {
		addFile(
			studio(),
			'brand-voice/SKILL.md',
			skillFile( 'brand-voice', 'House voice.', 'Warm.' )
		);
		addFile( studio(), 'brand-voice/.env', 'hidden' );
		addFile( root, 'outside.txt', 'outside' );
		symlinkSync(
			path.join( root, 'outside.txt' ),
			path.join( studio(), 'brand-voice', 'link.txt' )
		);

		const [ skill ] = await listServedSkills();
		expect( skill.resources ).toHaveLength( 1 );
		for ( const uri of [
			'skill://brand-voice/.env',
			'skill://brand-voice/link.txt',
			'skill://brand-voice/../../outside.txt',
			'skill://brand-voice/%2e%2e/%2e%2e/outside.txt',
			'skill://brand-voice/missing.md',
			'skill://missing/SKILL.md',
			'file:///etc/hostname',
		] ) {
			expect( await readServedSkillFile( uri ) ).toBeUndefined();
		}
		expect( await getServedSkill( 'skill://brand-voice/references/tone.md' ) ).toBeUndefined();
	} );
} );
