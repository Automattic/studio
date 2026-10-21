import { EventEmitter } from 'node:events';
import { describe, expect, it } from 'vitest';
import { readSiteIcon } from '@studio/common/sites/site-identity';
import type { ExecuteCliCommand } from '@studio/common/lib/cli-process';

function executeWithStdout( stdout: string ): ExecuteCliCommand {
	return ( () => {
		const emitter = new EventEmitter();
		setImmediate( () => emitter.emit( 'success', { result: { stdout } } ) );
		return [ emitter, {} ];
	} ) as unknown as ExecuteCliCommand;
}

describe( 'readSiteIcon', () => {
	it( 'reads a site without an icon despite stray output', async () => {
		await expect(
			readSiteIcon( executeWithStdout( 'null\n[notice X 0] something' ), '/site' )
		).resolves.toBeNull();
	} );

	it( 'rejects instead of throwing when the output has no JSON', async () => {
		await expect( readSiteIcon( executeWithStdout( 'Fatal error' ), '/site' ) ).rejects.toThrow(
			SyntaxError
		);
	} );
} );
