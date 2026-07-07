import os from 'os';
import path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import { getGlobalAgentsFilePath } from '../well-known-paths';

describe( 'getGlobalAgentsFilePath', () => {
	const originalDevConfigDir = process.env.DEV_CONFIG_DIR;
	const originalE2E = process.env.E2E;

	const restore = ( key: 'DEV_CONFIG_DIR' | 'E2E', value: string | undefined ) => {
		if ( value === undefined ) {
			delete process.env[ key ];
		} else {
			process.env[ key ] = value;
		}
	};

	afterEach( () => {
		restore( 'DEV_CONFIG_DIR', originalDevConfigDir );
		restore( 'E2E', originalE2E );
	} );

	it( 'resolves AGENTS.md inside a custom config directory', () => {
		process.env.DEV_CONFIG_DIR = '/custom/config/dir';
		expect( getGlobalAgentsFilePath() ).toBe( path.join( '/custom/config/dir', 'AGENTS.md' ) );
	} );

	it( 'defaults to ~/.studio/AGENTS.md', () => {
		delete process.env.DEV_CONFIG_DIR;
		delete process.env.E2E;
		expect( getGlobalAgentsFilePath() ).toBe( path.join( os.homedir(), '.studio', 'AGENTS.md' ) );
	} );
} );
