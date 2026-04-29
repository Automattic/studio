// @vitest-environment node
import { existsSync, mkdirSync, rmSync } from 'fs';
import path from 'path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Captures the `targets` arrays passed to every `viteStaticCopy(...)` call made
 * during evaluation of a Vite config module. Each entry corresponds to one
 * `viteStaticCopy` invocation, in registration order.
 */
const staticCopyTargetsByCall: Array< Array< { src: string | string[]; dest: string } > > = [];

vi.mock( 'vite-plugin-static-copy', () => ( {
	viteStaticCopy: ( options: { targets: Array< { src: string | string[]; dest: string } > } ) => {
		staticCopyTargetsByCall.push( options.targets );
		return { name: 'mock-vite-plugin-static-copy', apply: 'build' as const };
	},
} ) );

const dlaPath = path.resolve( import.meta.dirname, '..', 'ai/dla' );

/**
 * Reloads each Vite config under a fresh module graph so the `existsSync(dlaPath)`
 * branches re-evaluate against the current filesystem state. Returns the flattened
 * union of every static-copy target registered across the three configs.
 */
async function loadConfigsAndCollectTargets(): Promise<
	Array< { src: string | string[]; dest: string } >
> {
	staticCopyTargetsByCall.length = 0;
	vi.resetModules();
	await import( '../vite.config.dev' );
	await import( '../vite.config.npm' );
	await import( '../vite.config.prod' );
	return staticCopyTargetsByCall.flat();
}

/**
 * Returns true when any captured static-copy target points at the `ai/dla` source.
 */
function hasDlaTarget( targets: Array< { src: string | string[]; dest: string } > ): boolean {
	return targets.some( ( target ) => target.src === 'ai/dla' );
}

describe( 'Vite configs: ai/dla static-copy gating', () => {
	const dlaExistedBefore = existsSync( dlaPath );

	beforeAll( () => {
		// The test mutates `apps/cli/ai/dla/` on disk to flip the `existsSync` branch.
		// Refuse to run if the directory pre-existed so we never delete a real vendored tree.
		if ( dlaExistedBefore ) {
			throw new Error(
				`Refusing to run vite-config tests: ${ dlaPath } already exists. ` +
					'These tests create and delete that path; remove it before running them.'
			);
		}
	} );

	afterAll( () => {
		// Defensive cleanup — `afterEach` should have already removed the directory,
		// but make sure we leave the worktree clean even if a test threw.
		if ( ! dlaExistedBefore && existsSync( dlaPath ) ) {
			rmSync( dlaPath, { recursive: true, force: true } );
		}
	} );

	afterEach( () => {
		if ( existsSync( dlaPath ) ) {
			rmSync( dlaPath, { recursive: true, force: true } );
		}
	} );

	describe( 'when apps/cli/ai/dla/ does not exist', () => {
		beforeEach( () => {
			if ( existsSync( dlaPath ) ) {
				rmSync( dlaPath, { recursive: true, force: true } );
			}
		} );

		it( 'omits the ai/dla target from every config', async () => {
			const targets = await loadConfigsAndCollectTargets();
			expect( hasDlaTarget( targets ) ).toBe( false );
		} );

		it( 'still registers the ai/plugin target (unconditional) in every config', async () => {
			const targets = await loadConfigsAndCollectTargets();
			// Three configs each register `ai/plugin` once.
			const pluginTargets = targets.filter( ( target ) => target.src === 'ai/plugin' );
			expect( pluginTargets ).toHaveLength( 3 );
		} );
	} );

	describe( 'when apps/cli/ai/dla/ exists', () => {
		beforeEach( () => {
			mkdirSync( dlaPath, { recursive: true } );
		} );

		it( 'includes the ai/dla target in every config', async () => {
			const targets = await loadConfigsAndCollectTargets();
			const dlaTargets = targets.filter( ( target ) => target.src === 'ai/dla' );
			// Three configs each register `ai/dla` once when the directory exists.
			expect( dlaTargets ).toHaveLength( 3 );
			for ( const target of dlaTargets ) {
				expect( target.dest ).toBe( '.' );
			}
		} );
	} );
} );
