import fs from 'fs';
import os from 'os';
import path from 'path';
import { getProvider } from '@studio/providers/services';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { connectProvider } from '@studio/common/lib/ai-settings';
import { findAgentAppCli } from '@studio/common/lib/connect-agent-app';
import { startCommandSignIn } from '@studio/common/lib/connect-command';
import { readProviderConfig } from '@studio/common/lib/provider-config';

vi.mock( '@studio/common/lib/connect-agent-app', () => ( { findAgentAppCli: vi.fn() } ) );

// Signs in like `claude setup-token`: a link, a prompt for the browser's code, then the token,
// without exiting.
const FAKE_CLAUDE = `#!/bin/sh
printf 'Opening browser to sign in\\n\\033]8;;https://claude.test/authorize?x=1\\007https://claude.test/authorize?x=1\\033]8;;\\007\\n'
printf 'Paste code here if prompted > '
read code
if [ "$code" != "good#code" ]; then echo 'OAuth error: Invalid code'; exit 1; fi
printf '\\033[32mYour OAuth token (valid for 1 year):\\033[0m\\n\\nsk-ant-oat01-abc_DEF-123\\n\\n'
sleep 30
`;

describe.skipIf( process.platform === 'win32' )( 'command sign-in', () => {
	let dir: string;
	let previousDevConfigDir: string | undefined;

	beforeEach( () => {
		dir = fs.mkdtempSync( path.join( os.tmpdir(), 'studio-command-sign-in-' ) );
		const claude = path.join( dir, 'claude' );
		fs.writeFileSync( claude, FAKE_CLAUDE, { mode: 0o755 } );
		vi.mocked( findAgentAppCli ).mockResolvedValue( claude );
		previousDevConfigDir = process.env.DEV_CONFIG_DIR;
		process.env.DEV_CONFIG_DIR = dir;
		vi.stubGlobal( 'fetch', vi.fn().mockResolvedValue( { ok: true, status: 200 } ) );
	} );

	afterEach( () => {
		vi.unstubAllGlobals();
		if ( previousDevConfigDir === undefined ) {
			delete process.env.DEV_CONFIG_DIR;
		} else {
			process.env.DEV_CONFIG_DIR = previousDevConfigDir;
		}
		fs.rmSync( dir, { recursive: true, force: true } );
	} );

	it( 'connects with the token Claude Code prints for the browser’s code', async () => {
		const session = await startCommandSignIn( 'anthropic', 'setup-token' );
		expect( session.url ).toBe( 'https://claude.test/authorize?x=1' );

		await connectProvider( getProvider( 'anthropic' ), {
			method: 'setup-token',
			session: session.id,
			code: 'good#code',
		} );

		await expect( readProviderConfig( 'anthropic' ) ).resolves.toEqual( {
			method: 'setup-token',
			token: 'sk-ant-oat01-abc_DEF-123',
		} );
	} );

	it( 'reports what Claude Code says about a wrong code, and ends the sign-in', async () => {
		const session = await startCommandSignIn( 'anthropic', 'setup-token' );
		const connect = ( code: string ) =>
			connectProvider( getProvider( 'anthropic' ), {
				method: 'setup-token',
				session: session.id,
				code,
			} );

		await expect( connect( 'bad' ) ).rejects.toThrow( 'OAuth error: Invalid code' );
		await expect( connect( 'good#code' ) ).rejects.toThrow( 'The sign-in expired' );
	} );
} );
