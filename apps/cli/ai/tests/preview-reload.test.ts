import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPreviewReloader } from 'cli/ai/runtimes/pi/preview-reload';
import type { AgentSessionEvent } from '@earendil-works/pi-coding-agent';

let site: string;

// Writes a file and dates it `offsetSeconds` from now.
function write( relativePath: string, offsetSeconds = 5 ) {
	const file = path.join( site, relativePath );
	mkdirSync( path.dirname( file ), { recursive: true } );
	writeFileSync( file, 'x' );
	const time = Date.now() / 1000 + offsetSeconds;
	utimesSync( file, time, time );
	return file;
}

function turnEnd( calls: Array< { path: string; isError?: boolean } > ): AgentSessionEvent {
	return {
		type: 'turn_end',
		message: {
			role: 'assistant',
			content: calls.map( ( call, index ) => ( {
				type: 'toolCall',
				id: `call-${ index }`,
				name: 'Edit',
				arguments: { path: call.path },
			} ) ),
		},
		toolResults: calls.map( ( call, index ) => ( {
			role: 'toolResult',
			toolCallId: `call-${ index }`,
			toolName: 'Edit',
			content: [],
			isError: call.isError ?? false,
		} ) ),
	} as unknown as AgentSessionEvent;
}

const agentEnd = { type: 'agent_end', messages: [], willRetry: false } as AgentSessionEvent;
const retryingEnd = { type: 'agent_end', messages: [], willRetry: true } as AgentSessionEvent;

function reloader( getSitePath: () => string | undefined = () => site ) {
	const reload = vi.fn();
	return { reload, onEvent: createPreviewReloader( { getSitePath, cwd: site, reload } ) };
}

beforeEach( () => {
	site = mkdtempSync( path.join( tmpdir(), 'preview-reload-' ) );
	write( 'wp-content/database/.ht.sqlite', -60 );
	write( 'wp-content/themes/theme/style.css', -60 );
} );

afterEach( () => rmSync( site, { recursive: true, force: true } ) );

describe( 'createPreviewReloader', () => {
	it( 'reloads at the end of a turn whose tool call changed a file in wp-content', () => {
		const { reload, onEvent } = reloader();
		const file = write( 'wp-content/themes/theme/style.css' );
		onEvent( turnEnd( [ { path: file } ] ) );
		expect( reload ).toHaveBeenCalledTimes( 1 );
	} );

	it( 'resolves relative paths against the tools’ working directory', () => {
		const { reload, onEvent } = reloader();
		write( 'wp-content/themes/theme/parts/header.html' );
		onEvent( turnEnd( [ { path: 'wp-content/themes/theme/parts/header.html' } ] ) );
		expect( reload ).toHaveBeenCalledTimes( 1 );
	} );

	it( 'does not reload for a file that was only read, failed, or sits outside wp-content', () => {
		const { reload, onEvent } = reloader();
		onEvent( turnEnd( [ { path: path.join( site, 'wp-content/themes/theme/style.css' ) } ] ) );
		const failed = write( 'wp-content/themes/theme/theme.json' );
		onEvent( turnEnd( [ { path: failed, isError: true } ] ) );
		onEvent( turnEnd( [ { path: write( 'DESIGN.md' ) } ] ) );
		expect( reload ).not.toHaveBeenCalled();
	} );

	it( 'reloads once when the request ends if anything else in wp-content changed', async () => {
		const { reload, onEvent } = reloader();
		write( 'wp-content/database/.ht.sqlite' );
		onEvent( retryingEnd );
		onEvent( agentEnd );
		await vi.waitFor( () => expect( reload ).toHaveBeenCalledTimes( 1 ) );
	} );

	it( 'does not reload when the request ends if nothing changed since the last reload', async () => {
		const { reload, onEvent } = reloader();
		// Written a moment after the request started, as an agent's edit is.
		await new Promise( ( resolve ) => setTimeout( resolve, 20 ) );
		const file = path.join( site, 'wp-content/themes/theme/style.css' );
		writeFileSync( file, 'y' );
		onEvent( turnEnd( [ { path: file } ] ) );
		expect( reload ).toHaveBeenCalledTimes( 1 );
		onEvent( agentEnd );
		await new Promise( ( resolve ) => setTimeout( resolve, 50 ) );
		expect( reload ).toHaveBeenCalledTimes( 1 );
	} );

	it( 'reloads for a site the agent made active during the request, and not without one', () => {
		const active: { path?: string } = {};
		const { reload, onEvent } = reloader( () => active.path );
		onEvent( agentEnd );
		expect( reload ).not.toHaveBeenCalled();
		active.path = site;
		onEvent( agentEnd );
		expect( reload ).toHaveBeenCalledTimes( 1 );
	} );
} );
