import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
	getSiteAgentFiles,
	installAiInstructionsToSite,
	installSkillToSite,
	removeSiteAgentFile,
	setSiteAgentFileEnabled,
	updateManagedInstructionFiles,
} from '../agent-skills';

describe( 'site agent files', () => {
	let root: string;
	let site: string;
	let bundled: string;

	beforeEach( async () => {
		root = fs.mkdtempSync( path.join( os.tmpdir(), 'studio-agent-files-' ) );
		site = path.join( root, 'site' );
		bundled = path.join( root, 'bundled' );
		fs.mkdirSync( path.join( bundled, 'studio-cli' ), { recursive: true } );
		fs.writeFileSync( path.join( bundled, 'studio-cli', 'SKILL.md' ), 'bundled skill' );
		fs.writeFileSync( path.join( bundled, 'AGENTS.md' ), 'bundled agents' );
		fs.mkdirSync( site );
		await installAiInstructionsToSite( { path: site }, bundled, [ 'studio-cli' ] );
	} );

	afterEach( () => fs.rmSync( root, { recursive: true, force: true } ) );

	const read = ( ...segments: string[] ) =>
		fs.readFileSync( path.join( site, ...segments ), 'utf8' );

	const status = async ( kind: 'skills' | 'instructions', id: string ) =>
		( await getSiteAgentFiles( site, kind ) ).find( ( file ) => file.id === id );

	it( 'switches a skill off and on, keeping its edits, and installs leave it off', async () => {
		fs.writeFileSync( path.join( site, '.agents', 'skills', 'studio-cli', 'SKILL.md' ), 'edited' );

		await setSiteAgentFileEnabled( site, bundled, 'skills', 'studio-cli', false );
		expect( await status( 'skills', 'studio-cli' ) ).toMatchObject( {
			installed: true,
			enabled: false,
		} );
		expect( fs.existsSync( path.join( site, '.claude', 'skills', 'studio-cli' ) ) ).toBe( false );

		await installAiInstructionsToSite( { path: site }, bundled, [ 'studio-cli' ] );
		expect( ( await status( 'skills', 'studio-cli' ) )?.enabled ).toBe( false );

		await setSiteAgentFileEnabled( site, bundled, 'skills', 'studio-cli', true );
		expect(
			fs.readFileSync( path.join( site, '.claude', 'skills', 'studio-cli', 'SKILL.md' ), 'utf8' )
		).toBe( 'edited' );
	} );

	it( 'switches an instruction file off without reinstalling it, and uninstalls it', async () => {
		await setSiteAgentFileEnabled( site, bundled, 'instructions', 'AGENTS.md', false );
		await installAiInstructionsToSite( { path: site }, bundled );
		expect( fs.existsSync( path.join( site, 'AGENTS.md' ) ) ).toBe( false );
		expect( ( await status( 'instructions', 'AGENTS.md' ) )?.installed ).toBe( true );

		await removeSiteAgentFile( site, 'instructions', 'AGENTS.md' );
		expect( ( await status( 'instructions', 'AGENTS.md' ) )?.installed ).toBe( false );
	} );

	it( 'keeps existing files unless asked to overwrite, and installs only selected skills', async () => {
		fs.writeFileSync( path.join( site, 'AGENTS.md' ), 'edited agents' );
		fs.writeFileSync( path.join( site, '.agents', 'skills', 'studio-cli', 'SKILL.md' ), 'edited' );
		fs.mkdirSync( path.join( bundled, 'wp-rest-api' ) );
		fs.writeFileSync( path.join( bundled, 'wp-rest-api', 'SKILL.md' ), 'rest skill' );
		fs.writeFileSync( path.join( bundled, 'index.ts' ), '' );

		await installAiInstructionsToSite( { path: site }, bundled, [ 'studio-cli' ] );
		expect( read( 'AGENTS.md' ) ).toBe( 'edited agents' );
		expect( read( '.claude', 'skills', 'studio-cli', 'SKILL.md' ) ).toBe( 'edited' );
		expect( fs.existsSync( path.join( site, '.agents', 'skills', 'wp-rest-api' ) ) ).toBe( false );
		expect( fs.existsSync( path.join( site, 'index.ts' ) ) ).toBe( false );

		await installAiInstructionsToSite( { path: site }, bundled, [ 'studio-cli' ], true );
		expect( read( 'AGENTS.md' ) ).toBe( 'bundled agents' );
		expect( read( '.claude', 'skills', 'studio-cli', 'SKILL.md' ) ).toBe( 'bundled skill' );

		await expect(
			installAiInstructionsToSite( { path: site }, path.join( root, 'missing' ) )
		).resolves.toBeUndefined();
	} );

	it( 'refreshes managed instruction files only on sites that already have them', async () => {
		fs.writeFileSync( path.join( site, 'STUDIO.md' ), 'old' );
		await updateManagedInstructionFiles( { path: site }, bundled );
		expect( read( 'STUDIO.md' ) ).toBe( 'old' );

		fs.writeFileSync( path.join( bundled, 'STUDIO.md' ), 'new' );
		await updateManagedInstructionFiles( { path: site }, bundled );
		expect( read( 'STUDIO.md' ) ).toBe( 'new' );

		fs.rmSync( path.join( site, 'STUDIO.md' ) );
		await updateManagedInstructionFiles( { path: site }, bundled );
		expect( fs.existsSync( path.join( site, 'STUDIO.md' ) ) ).toBe( false );
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
