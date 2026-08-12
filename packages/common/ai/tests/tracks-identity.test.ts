import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { AGENT_NAME, getAiTracksIdentity } from '../tracks-identity';

describe( 'getAiTracksIdentity', () => {
	it( 'reports the agent identity shared by every Studio Code event', () => {
		expect( getAiTracksIdentity( 'session-uuid' ) ).toEqual( {
			ai_session_id: 'session-uuid',
			agent_name: AGENT_NAME,
			agent_version: expect.stringMatching( /^\d+\.\d+\.\d+/ ),
			client: 'studio-code',
		} );
	} );

	// `agent_version` is a constant rather than pi's exported `VERSION`. pi is a *devDependency* of
	// this package (it is bundled at build time, not resolved at runtime), so importing from it here
	// would add a runtime import of a dev-only dependency; the module it lives in also probes the
	// filesystem and shells out to the package manager at import time. This guards the copy against
	// drifting when the dependency is upgraded.
	it( 'matches the pinned pi-coding-agent dependency', () => {
		const testDir = path.dirname( fileURLToPath( import.meta.url ) );
		const manifest = JSON.parse(
			readFileSync( path.join( testDir, '../../package.json' ), 'utf8' )
		);
		const pinned =
			manifest.dependencies?.[ '@earendil-works/pi-coding-agent' ] ??
			manifest.devDependencies?.[ '@earendil-works/pi-coding-agent' ];

		// An exact pin, never a range — see the Playground/PHP-WASM note in AGENTS.md.
		expect( pinned ).toMatch( /^\d+\.\d+\.\d+/ );
		expect( getAiTracksIdentity( 'session-uuid' ).agent_version ).toBe( pinned );
	} );
} );
