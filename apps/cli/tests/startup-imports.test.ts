import { readFileSync } from 'fs';
import path from 'path';
import { describe, expect, it, vi } from 'vitest';

const loadedAtStartup = vi.hoisted( () => new Set< string >() );

// Modules that each cost hundreds of milliseconds to load in the packaged app, so only the
// code that uses them loads them.
// The agent runtime is large.
vi.mock( '@earendil-works/pi-coding-agent', () => {
	loadedAtStartup.add( '@earendil-works/pi-coding-agent' );
	return {};
} );
// The `date-fns` root loads every one of its functions, about 300 modules. Each function
// has its own path, e.g. `date-fns/format`.
vi.mock( 'date-fns', () => {
	loadedAtStartup.add( 'date-fns' );
	return {};
} );
// `@inquirer/prompts` loads every prompt type, each with its own copy of `@inquirer/core`.
// `cli/lib/prompts` loads it when a prompt is shown.
vi.mock( '@inquirer/prompts', () => {
	loadedAtStartup.add( '@inquirer/prompts' );
	return {};
} );

// Every `studio` command loads what the CLI entry imports statically before it runs.
describe( 'CLI startup', () => {
	it( 'loads no heavy module before a command runs', async () => {
		const entry = readFileSync( path.join( import.meta.dirname, '..', 'index.ts' ), 'utf8' );
		const staticImports = [ ...entry.matchAll( /^import [^;]*? from '(cli\/[^']+)';$/gm ) ].map(
			( [ , specifier ] ) => specifier
		);
		expect( staticImports ).toContain( 'cli/commands/mcp' );

		for ( const specifier of staticImports ) {
			await import( /* @vite-ignore */ specifier );
		}

		expect( [ ...loadedAtStartup ] ).toEqual( [] );
	} );
} );
