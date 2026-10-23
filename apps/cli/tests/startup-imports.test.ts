import { readFileSync } from 'fs';
import path from 'path';
import { describe, expect, it, vi } from 'vitest';

const agentRuntimeLoaded = vi.hoisted( () => ( { value: false } ) );
const dateFnsRootLoaded = vi.hoisted( () => ( { value: false } ) );

vi.mock( '@earendil-works/pi-coding-agent', () => {
	agentRuntimeLoaded.value = true;
	return {};
} );

// The `date-fns` root loads every one of its functions, about 300 modules, which took
// about 0.9 s in the packaged app. Each function has its own path, e.g. `date-fns/format`.
vi.mock( 'date-fns', () => {
	dateFnsRootLoaded.value = true;
	return {};
} );

// Every `studio` command loads what the CLI entry imports statically before it
// runs. The agent runtime is large, so only the commands that use it load it.
describe( 'CLI startup', () => {
	it( 'loads no agent runtime or date-fns root before a command runs', async () => {
		const entry = readFileSync( path.join( import.meta.dirname, '..', 'index.ts' ), 'utf8' );
		const staticImports = [ ...entry.matchAll( /^import [^;]*? from '(cli\/[^']+)';$/gm ) ].map(
			( [ , specifier ] ) => specifier
		);
		expect( staticImports ).toContain( 'cli/commands/mcp' );

		for ( const specifier of staticImports ) {
			await import( /* @vite-ignore */ specifier );
		}

		expect( agentRuntimeLoaded.value ).toBe( false );
		expect( dateFnsRootLoaded.value ).toBe( false );
	} );
} );
