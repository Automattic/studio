import { readFileSync } from 'fs';
import path from 'path';
import { describe, expect, it, vi } from 'vitest';

const agentRuntimeLoaded = vi.hoisted( () => ( { value: false } ) );

vi.mock( '@earendil-works/pi-coding-agent', () => {
	agentRuntimeLoaded.value = true;
	return {};
} );

// Every `studio` command loads what the CLI entry imports statically before it
// runs. The agent runtime is large, so only the commands that use it load it.
describe( 'CLI startup', () => {
	it( 'loads no agent runtime before a command runs', async () => {
		const entry = readFileSync( path.join( import.meta.dirname, '..', 'index.ts' ), 'utf8' );
		const staticImports = [ ...entry.matchAll( /^import [^;]*? from '(cli\/[^']+)';$/gm ) ].map(
			( [ , specifier ] ) => specifier
		);
		expect( staticImports ).toContain( 'cli/commands/mcp' );

		for ( const specifier of staticImports ) {
			await import( /* @vite-ignore */ specifier );
		}

		expect( agentRuntimeLoaded.value ).toBe( false );
	} );
} );
