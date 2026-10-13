import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, test } from 'vitest';
import { pruneNodeModules } from './prune-bundled-node-modules.mjs';

let root;

afterEach( () => {
	fs.rmSync( root, { recursive: true, force: true } );
} );

function addPackage( relativeDir, manifest ) {
	const dir = path.join( root, relativeDir );
	fs.mkdirSync( dir, { recursive: true } );
	fs.writeFileSync( path.join( dir, 'package.json' ), JSON.stringify( manifest ) );
}

const exists = ( relativeDir ) => fs.existsSync( path.join( root, relativeDir ) );

test( 'removes nested copies that match the version Node would resolve without them', () => {
	root = fs.mkdtempSync( path.join( os.tmpdir(), 'prune-' ) );
	addPackage( 'openai', { name: 'openai', version: '6.40.0' } );
	addPackage( 'typebox', { name: 'typebox', version: '1.3.37' } );
	addPackage( '@scope/agent', { name: '@scope/agent', version: '1.0.0' } );
	addPackage( '@scope/agent/node_modules/openai', { name: 'openai', version: '6.40.0' } );
	addPackage( '@scope/agent/node_modules/typebox', { name: 'typebox', version: '1.3.7' } );
	addPackage( '@scope/agent/node_modules/only-nested', { name: 'only-nested', version: '1.0.0' } );
	addPackage( '@scope/agent/node_modules/typebox/node_modules/openai', {
		name: 'openai',
		version: '6.40.0',
	} );

	pruneNodeModules( root );

	assert.ok( exists( 'openai' ) );
	assert.ok( ! exists( '@scope/agent/node_modules/openai' ) );
	assert.ok( exists( '@scope/agent/node_modules/typebox' ) );
	assert.ok( exists( '@scope/agent/node_modules/only-nested' ) );
	assert.ok( ! exists( '@scope/agent/node_modules/typebox/node_modules/openai' ) );
} );

test( 'keeps a nested copy when a nearer ancestor resolves to a different version', () => {
	root = fs.mkdtempSync( path.join( os.tmpdir(), 'prune-' ) );
	addPackage( 'lib', { name: 'lib', version: '2.0.0' } );
	addPackage( 'a', { name: 'a', version: '1.0.0' } );
	addPackage( 'a/node_modules/lib', { name: 'lib', version: '1.0.0' } );
	addPackage( 'a/node_modules/b', { name: 'b', version: '1.0.0' } );
	addPackage( 'a/node_modules/b/node_modules/lib', { name: 'lib', version: '2.0.0' } );

	pruneNodeModules( root );

	assert.ok( exists( 'a/node_modules/lib' ) );
	assert.ok( exists( 'a/node_modules/b/node_modules/lib' ) );
} );

test( 'removes packages built for another platform, and another arch only when given', () => {
	root = fs.mkdtempSync( path.join( os.tmpdir(), 'prune-' ) );
	addPackage( 'clip-darwin-universal', { name: 'clip-darwin-universal', os: [ 'darwin' ] } );
	addPackage( 'clip-darwin-x64', { name: 'clip-darwin-x64', os: [ 'darwin' ], cpu: [ 'x64' ] } );
	addPackage( 'clip-win32-x64', { name: 'clip-win32-x64', os: [ 'win32' ], cpu: [ 'x64' ] } );
	addPackage( 'not-windows', { name: 'not-windows', os: [ '!win32' ] } );

	pruneNodeModules( root, { platform: 'darwin' } );
	assert.ok( exists( 'clip-darwin-x64' ) );
	assert.ok( ! exists( 'clip-win32-x64' ) );
	assert.ok( exists( 'not-windows' ) );

	pruneNodeModules( root, { platform: 'darwin', arch: 'arm64' } );
	assert.ok( exists( 'clip-darwin-universal' ) );
	assert.ok( ! exists( 'clip-darwin-x64' ) );
} );
