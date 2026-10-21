import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
	getSiteAgentFiles,
	installAiInstructionsToSite,
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
		fs.mkdirSync( path.join( bundled, 'studio-cli' ), { recursive: true } );
		fs.writeFileSync( path.join( bundled, 'studio-cli', 'SKILL.md' ), 'bundled skill' );
		fs.writeFileSync( path.join( bundled, 'AGENTS.md' ), 'bundled agents' );
		fs.mkdirSync( site );
		await installAiInstructionsToSite( { path: site }, bundled, [ 'studio-cli' ] );
	} );

	afterEach( () => fs.rmSync( root, { recursive: true, force: true } ) );

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
} );
