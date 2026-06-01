/**
 * @vitest-environment node
 */
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { readSharedConfig } from '@studio/common/lib/shared-config';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
	studioCodeAbort,
	studioCodeCheckProvider,
	studioCodeRespondToPermission,
	studioCodeSendMessage,
} from '../ipc-handlers';
import { abortTurn, answerTurn, spawnTurn } from '../studio-code-process';
import type { IpcMainInvokeEvent } from 'electron';

vi.mock( '../studio-code-process', () => ( {
	spawnTurn: vi.fn(),
	answerTurn: vi.fn(),
	abortTurn: vi.fn(),
} ) );

vi.mock( '@studio/common/lib/shared-config', () => ( {
	readSharedConfig: vi.fn(),
} ) );

vi.mock( 'node:fs', () => ( {
	existsSync: vi.fn(),
} ) );

const mockEvent = {} as IpcMainInvokeEvent;

beforeEach( () => {
	vi.clearAllMocks();
} );

describe( 'studioCodeSendMessage', () => {
	it( 'delegates to spawnTurn', async () => {
		await studioCodeSendMessage( mockEvent, 'site-1', '/sites/one', 'One', 'hello' );
		expect( spawnTurn ).toHaveBeenCalledWith( 'site-1', '/sites/one', 'One', 'hello' );
	} );
} );

describe( 'studioCodeRespondToPermission', () => {
	it( 'delivers the answer to the live child via answerTurn (no respawn)', async () => {
		await studioCodeRespondToPermission( mockEvent, 'site-1', '/sites/one', 'One', 'Continue', {
			'Allow read?': 'Allow',
		} );
		expect( answerTurn ).toHaveBeenCalledWith( 'site-1', { 'Allow read?': 'Allow' } );
		expect( spawnTurn ).not.toHaveBeenCalled();
	} );
} );

describe( 'studioCodeAbort', () => {
	it( 'delegates to abortTurn', () => {
		studioCodeAbort( mockEvent, 'site-1' );
		expect( abortTurn ).toHaveBeenCalledWith( 'site-1' );
	} );
} );

describe( 'studioCodeCheckProvider', () => {
	it( 'reports no providers when nothing is configured', async () => {
		vi.mocked( readSharedConfig ).mockResolvedValue( {} as never );
		vi.mocked( fs.existsSync ).mockReturnValue( false );
		delete process.env.ANTHROPIC_API_KEY;

		const result = await studioCodeCheckProvider( mockEvent );
		expect( result ).toEqual( { available: false, providers: [] } );
	} );

	it( 'detects wpcom, anthropic-api-key, and anthropic-claude providers', async () => {
		vi.mocked( readSharedConfig ).mockResolvedValue( { authToken: { accessToken: 'x' } } as never );
		process.env.ANTHROPIC_API_KEY = 'sk-test';
		const claudeConfigPath = path.join( os.homedir(), '.claude', '.credentials.json' );
		vi.mocked( fs.existsSync ).mockImplementation( ( p ) => p === claudeConfigPath );

		const result = await studioCodeCheckProvider( mockEvent );
		expect( result.available ).toBe( true );
		expect( result.providers ).toEqual(
			expect.arrayContaining( [ 'wpcom', 'anthropic-api-key', 'anthropic-claude' ] )
		);

		delete process.env.ANTHROPIC_API_KEY;
	} );
} );
