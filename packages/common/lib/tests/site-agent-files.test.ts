import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
	getSiteAgentFiles,
	installSelectedSkillsToSite,
	installSkillToSite,
	removeSiteAgentFile,
	setSiteAgentFileEnabled,
} from '../agent-skills';

describe( 'site agent files', () => {
	let root: string;
	let site: string;
	let bundled: string;

	beforeEach( async () => {
		root = fs.mkdtempSync( path.join( os.tmpdir(), 'studio-agent-files-' ) );
		site = path.join( root, 'site' );
		bundled = path.join( root, 'bundled' );
		fs.mkdirSync( path.join( bundled, 'wp-plugin-development' ), { recursive: true } );
		fs.writeFileSync( path.join( bundled, 'wp-plugin-development', 'SKILL.md' ), 'bundled skill' );
		fs.mkdirSync( site );
		await installSelectedSkillsToSite( { path: site }, bundled, [ 'wp-plugin-development' ] );
	} );

	afterEach( () => fs.rmSync( root, { recursive: true, force: true } ) );

	const read = ( ...segments: string[] ) =>
		fs.readFileSync( path.join( site, ...segments ), 'utf8' );

	const status = async ( id: string ) =>
		( await getSiteAgentFiles( site ) ).find( ( file ) => file.id === id );

	it( 'switches a skill off and on, keeping its edits, and installs leave it off', async () => {
		fs.writeFileSync(
			path.join( site, '.agents', 'skills', 'wp-plugin-development', 'SKILL.md' ),
			'edited'
		);

		await setSiteAgentFileEnabled( site, bundled, 'wp-plugin-development', false );
		expect( await status( 'wp-plugin-development' ) ).toMatchObject( {
			installed: true,
			enabled: false,
		} );
		expect( fs.existsSync( path.join( site, '.claude', 'skills', 'wp-plugin-development' ) ) ).toBe(
			false
		);

		await installSelectedSkillsToSite( { path: site }, bundled, [ 'wp-plugin-development' ] );
		expect( ( await status( 'wp-plugin-development' ) )?.enabled ).toBe( false );

		await setSiteAgentFileEnabled( site, bundled, 'wp-plugin-development', true );
		expect(
			fs.readFileSync(
				path.join( site, '.claude', 'skills', 'wp-plugin-development', 'SKILL.md' ),
				'utf8'
			)
		).toBe( 'edited' );
	} );

	it( 'uninstalls a skill, switched on or off', async () => {
		await setSiteAgentFileEnabled( site, bundled, 'wp-plugin-development', false );
		await removeSiteAgentFile( site, 'wp-plugin-development' );
		expect( ( await status( 'wp-plugin-development' ) )?.installed ).toBe( false );
		expect(
			fs.existsSync( path.join( site, '.agents', 'disabled-skills', 'wp-plugin-development' ) )
		).toBe( false );
	} );

	it( 'keeps existing files unless asked to overwrite, and installs only selected skills', async () => {
		fs.writeFileSync(
			path.join( site, '.agents', 'skills', 'wp-plugin-development', 'SKILL.md' ),
			'edited'
		);
		fs.mkdirSync( path.join( bundled, 'wp-rest-api' ) );
		fs.writeFileSync( path.join( bundled, 'wp-rest-api', 'SKILL.md' ), 'rest skill' );
		fs.writeFileSync( path.join( bundled, 'AGENTS.md' ), 'loose file' );

		await installSelectedSkillsToSite( { path: site }, bundled, [ 'wp-plugin-development' ] );
		expect( read( '.claude', 'skills', 'wp-plugin-development', 'SKILL.md' ) ).toBe( 'edited' );
		expect( fs.existsSync( path.join( site, '.agents', 'skills', 'wp-rest-api' ) ) ).toBe( false );
		expect( fs.existsSync( path.join( site, 'AGENTS.md' ) ) ).toBe( false );

		await installSelectedSkillsToSite( { path: site }, bundled, [ 'wp-plugin-development' ], true );
		expect( read( '.claude', 'skills', 'wp-plugin-development', 'SKILL.md' ) ).toBe(
			'bundled skill'
		);

		await expect(
			installSelectedSkillsToSite( { path: site }, path.join( root, 'missing' ) )
		).resolves.toBeUndefined();
	} );

	it( 'links a skill with a junction when Windows refuses the symlink', async () => {
		fs.mkdirSync( path.join( bundled, 'wp-rest-api' ) );
		fs.writeFileSync( path.join( bundled, 'wp-rest-api', 'SKILL.md' ), 'rest skill' );
		const originalPlatform = process.platform;
		Object.defineProperty( process, 'platform', { value: 'win32' } );
		const symlink = vi
			.spyOn( fs.promises, 'symlink' )
			.mockRejectedValueOnce( Object.assign( new Error( 'EPERM' ), { code: 'EPERM' } ) );

		try {
			await installSkillToSite( { path: site }, bundled, 'wp-rest-api', false );
			expect( symlink ).toHaveBeenLastCalledWith(
				path.resolve( site, '.agents', 'skills', 'wp-rest-api' ),
				path.join( site, '.claude', 'skills', 'wp-rest-api' ),
				'junction'
			);
		} finally {
			Object.defineProperty( process, 'platform', { value: originalPlatform } );
			symlink.mockRestore();
		}
		expect( read( '.claude', 'skills', 'wp-rest-api', 'SKILL.md' ) ).toBe( 'rest skill' );
	} );
} );
