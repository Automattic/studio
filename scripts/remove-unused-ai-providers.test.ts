import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { pruneUnusedProviders } from './remove-unused-ai-providers';

describe( 'pruneUnusedProviders', () => {
	let root: string;
	let nm: string;

	const touch = ( ...segments: string[] ) => {
		const file = join( nm, ...segments );
		mkdirSync( join( file, '..' ), { recursive: true } );
		writeFileSync( file, '' );
	};
	const has = ( ...segments: string[] ) => existsSync( join( nm, ...segments ) );

	beforeEach( () => {
		root = mkdtempSync( join( tmpdir(), 'prune-providers-' ) );
		nm = join( root, 'node_modules' );
		mkdirSync( nm, { recursive: true } );
	} );

	afterEach( () => {
		rmSync( root, { recursive: true, force: true } );
	} );

	it( 'removes unused provider SDKs hoisted at the top level', () => {
		touch( '@mistralai', 'mistralai', 'package.json' );
		touch( '@aws-sdk', 'client-bedrock-runtime', 'package.json' );
		touch( '@aws-crypto', 'sha256-js', 'package.json' );
		touch( '@smithy', 'node-http-handler', 'package.json' );
		touch( '@google', 'genai', 'package.json' );

		pruneUnusedProviders( nm );

		expect( has( '@mistralai' ) ).toBe( false );
		expect( has( '@aws-sdk' ) ).toBe( false );
		expect( has( '@aws-crypto' ) ).toBe( false );
		expect( has( '@smithy' ) ).toBe( false );
		expect( has( '@google', 'genai' ) ).toBe( false );
	} );

	it( 'removes copies nested under another package (e.g. pi-coding-agent)', () => {
		touch( '@earendil-works', 'pi-coding-agent', 'package.json' );
		const nested = join( '@earendil-works', 'pi-coding-agent', 'node_modules' );
		touch( nested, '@mistralai', 'mistralai', 'esm', 'index.js' );
		touch( nested, '@aws-sdk', 'core', 'index.js' );
		touch( nested, 'openai', 'index.js' );

		pruneUnusedProviders( nm );

		expect( has( nested, '@mistralai' ) ).toBe( false );
		expect( has( nested, '@aws-sdk' ) ).toBe( false );
		// The package that owns the nested copies, and its still-used deps, must survive.
		expect( has( '@earendil-works', 'pi-coding-agent', 'package.json' ) ).toBe( true );
		expect( has( nested, 'openai' ) ).toBe( true );
	} );

	it( 'keeps the providers Studio actually uses and unrelated @google packages', () => {
		touch( '@anthropic-ai', 'sdk', 'package.json' );
		touch( 'openai', 'package.json' );
		touch( '@google', 'other-tool', 'package.json' );

		pruneUnusedProviders( nm );

		expect( has( '@anthropic-ai', 'sdk' ) ).toBe( true );
		expect( has( 'openai' ) ).toBe( true );
		expect( has( '@google', 'other-tool' ) ).toBe( true );
	} );

	it( 'is a no-op when the node_modules directory is absent', () => {
		expect( () => pruneUnusedProviders( join( root, 'missing' ) ) ).not.toThrow();
	} );
} );
