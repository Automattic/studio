import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
	getChromiumLaunchCandidates,
	getPreferredChromiumLaunchOptions,
} from '../browser-utils';

describe( 'browser-utils', () => {
	beforeEach( () => {
		vi.unstubAllEnvs();
	} );

	afterEach( () => {
		vi.unstubAllEnvs();
	} );

	it( 'prefers the resolved Chromium executable when it exists', () => {
		const executablePath = '/bin/sh';

		const options = getPreferredChromiumLaunchOptions( {
			executablePath: () => executablePath,
		} );

		expect( options ).toEqual( {
			args: [ '--ignore-certificate-errors' ],
			executablePath,
		} );
	} );

	it( 'always includes a default Playwright launch fallback', () => {
		const candidates = getChromiumLaunchCandidates( {
			executablePath: () => '/missing/chromium',
		} );

		expect( candidates.at( -1 ) ).toEqual( {
			args: [ '--ignore-certificate-errors' ],
		} );
	} );

	it( 'can resolve another local browser when Playwright executable is unavailable', () => {
		const options = getPreferredChromiumLaunchOptions( {
			executablePath: () => '/missing/chromium',
		} );

		expect( options?.args ).toEqual( [ '--ignore-certificate-errors' ] );
	} );

	it( 'prefers an explicit MCP browser executable path override', () => {
		vi.stubEnv( 'STUDIO_MCP_BROWSER_EXECUTABLE_PATH', '/bin/sh' );

		const options = getPreferredChromiumLaunchOptions( {
			executablePath: () => '/missing/chromium',
		} );

		expect( options ).toEqual( {
			args: [ '--ignore-certificate-errors' ],
			executablePath: '/bin/sh',
		} );
	} );

	it( 'includes configured channels as fallbacks for external environments', () => {
		vi.stubEnv( 'STUDIO_MCP_BROWSER_CHANNEL', 'chrome' );

		const options = getChromiumLaunchCandidates( {
			executablePath: () => '/missing/chromium',
		} );

		expect( options ).toContainEqual( {
			args: [ '--ignore-certificate-errors' ],
			channel: 'chrome',
		} );
	} );
} );
