import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { buildConfigFromLegacy } from '@studio/common/lib/config/legacy-import';
import { CONFIG_VERSION } from '@studio/common/lib/config/schema';
import { getConfigPath, readConfig, updateConfig } from '@studio/common/lib/config/store';

const frontend = {
	path: '/sites/blog/frontend',
	kind: 'command',
	framework: 'next',
	devCommand: 'npm run dev -- --port ${port}',
	port: 3000,
	api: 'graphql',
	previewSecret: 'preview',
	revalidateSecret: 'revalidate',
};
const site = {
	id: 'blog',
	name: 'Blog',
	path: '/sites/blog/wordpress',
	port: 8881,
	phpVersion: '8.3',
	frontend,
};

let configDir: string;

beforeEach( () => {
	configDir = mkdtempSync( path.join( os.tmpdir(), 'studio-headless-config-' ) );
	process.env.DEV_CONFIG_DIR = configDir;
} );

afterEach( () => {
	delete process.env.DEV_CONFIG_DIR;
	rmSync( configDir, { recursive: true, force: true } );
} );

it( "keeps a headless site's frontend when the older config files are imported", () => {
	const config = buildConfigFromLegacy( { cli: { version: 1, sites: [ site ], snapshots: [] } } );

	expect( config.sites ).toEqual( [ expect.objectContaining( { id: 'blog', frontend } ) ] );
} );

it( "reads a headless site's frontend and keeps it when another site field changes", async () => {
	writeFileSync( getConfigPath(), JSON.stringify( { version: CONFIG_VERSION, sites: [ site ] } ) );

	await updateConfig( ( config ) => {
		config.sites[ 0 ].phpVersion = '8.4';
	} );

	expect( ( await readConfig() ).sites ).toEqual( [
		expect.objectContaining( { phpVersion: '8.4', frontend } ),
	] );
} );
