import { describe, expect, it } from 'vitest';
import { buildSystemPrompt } from 'cli/ai/system-prompt';

describe( 'buildSystemPrompt', () => {
	it( 'omits the remote-session guidance by default for local sites', () => {
		const prompt = buildSystemPrompt();
		expect( prompt ).not.toMatch( /Telegram remote session/ );
	} );

	it( 'appends the remote-session guidance to the local prompt when remoteSession is true', () => {
		const prompt = buildSystemPrompt( { remoteSession: true } );
		expect( prompt ).toMatch( /Telegram remote session/ );
		expect( prompt ).toMatch( /share_screenshot/ );
		expect( prompt ).toMatch( /preview site/i );
		// Caption guidance should steer the agent away from capture-mode wording.
		expect( prompt ).toMatch( /do NOT mention "full page"/ );
		// No-fabrication rule must be present so the agent stops inventing
		// "gist stored" / "preview link saved" epilogues.
		expect( prompt ).toMatch( /gist storage/ );
		expect( prompt ).toMatch( /Do NOT claim to have stored/ );
	} );

	it( 'appends the remote-session guidance to the remote-site prompt when remoteSession is true', () => {
		const prompt = buildSystemPrompt( {
			remoteSite: { name: 'Example', url: 'https://example.test', id: 1 },
			remoteSession: true,
		} );
		expect( prompt ).toMatch( /Telegram remote session/ );
		expect( prompt ).toMatch( /share_screenshot/ );
	} );

	it( 'omits the remote-session guidance when remoteSession is undefined or false', () => {
		const prompt = buildSystemPrompt( {
			remoteSite: { name: 'Example', url: 'https://example.test', id: 1 },
		} );
		expect( prompt ).not.toMatch( /Telegram remote session/ );
	} );
} );
