import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
	readGlobalInstructions,
	readGlobalInstructionsEnabled,
	readGlobalInstructionsFile,
	writeGlobalInstructions,
	writeGlobalInstructionsEnabled,
} from '../global-instructions';

describe( 'global-instructions', () => {
	let configDir: string;
	let previousDevConfigDir: string | undefined;

	beforeEach( () => {
		configDir = fs.mkdtempSync( path.join( os.tmpdir(), 'studio-global-instructions-' ) );
		previousDevConfigDir = process.env.DEV_CONFIG_DIR;
		process.env.DEV_CONFIG_DIR = configDir;
	} );

	afterEach( () => {
		if ( previousDevConfigDir === undefined ) {
			delete process.env.DEV_CONFIG_DIR;
		} else {
			process.env.DEV_CONFIG_DIR = previousDevConfigDir;
		}
		fs.rmSync( configDir, { recursive: true, force: true } );
	} );

	it( 'returns undefined when the instructions file does not exist', async () => {
		expect( await readGlobalInstructions() ).toBeUndefined();
	} );

	it( 'returns undefined when the instructions file is empty or whitespace', async () => {
		await writeGlobalInstructions( '  \n\t\n' );
		expect( await readGlobalInstructions() ).toBeUndefined();
	} );

	it( 'round-trips written instructions, trimmed for the prompt', async () => {
		await writeGlobalInstructions( '\nAlways answer in French.\n' );
		expect( await readGlobalInstructions() ).toBe( 'Always answer in French.' );
	} );

	it( 'defaults to enabled when existing instructions have content', async () => {
		await writeGlobalInstructions( 'Always answer in French.' );
		expect( await readGlobalInstructionsEnabled() ).toBe( true );
	} );

	it( 'preserves instructions while disabling their prompt injection', async () => {
		await writeGlobalInstructions( 'Always answer in French.' );
		await writeGlobalInstructionsEnabled( false );

		expect( await readGlobalInstructions() ).toBeUndefined();
		expect( await readGlobalInstructionsFile() ).toBe( 'Always answer in French.' );
		expect( await readGlobalInstructionsEnabled() ).toBe( false );
	} );

	it( 'restores preserved instructions when re-enabled', async () => {
		await writeGlobalInstructions( 'Always answer in French.' );
		await writeGlobalInstructionsEnabled( false );
		await writeGlobalInstructionsEnabled( true );

		expect( await readGlobalInstructions() ).toBe( 'Always answer in French.' );
	} );

	it( 'reads the raw file content for editing, preserving whitespace', async () => {
		await writeGlobalInstructions( '\n# Notes\n' );
		expect( await readGlobalInstructionsFile() ).toBe( '\n# Notes\n' );
	} );

	it( 'returns null for editing when the file does not exist', async () => {
		expect( await readGlobalInstructionsFile() ).toBeNull();
	} );
} );
