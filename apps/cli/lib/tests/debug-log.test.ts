import { appendFileSync } from 'fs';
import { tmpdir } from 'os';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock( 'fs', () => {
	const mockedModule = {
		appendFileSync: vi.fn(),
	};
	return {
		...mockedModule,
		default: mockedModule,
	};
} );

vi.mock( 'os', () => {
	const mockedModule = {
		tmpdir: vi.fn(),
	};
	return {
		...mockedModule,
		default: mockedModule,
	};
} );

describe( 'createDebugLogger', () => {
	const originalEnv = { ...process.env };

	beforeEach( () => {
		vi.resetModules();
		vi.clearAllMocks();
		process.env = { ...originalEnv };
		vi.mocked( tmpdir ).mockReturnValue( '/tmp/studio-tests' );
		vi.useFakeTimers();
		vi.setSystemTime( new Date( '2026-03-12T10:00:00.000Z' ) );
	} );

	afterEach( () => {
		process.env = { ...originalEnv };
		vi.useRealTimers();
	} );

	it( 'uses the default tmpdir path and skips writes when disabled', async () => {
		delete process.env.STUDIO_AI_DEBUG;

		const { createDebugLogger } = await import( '../debug-log' );
		const logger = createDebugLogger( {
			enabledEnvVar: 'STUDIO_AI_DEBUG',
			defaultFilename: 'studio-ai-debug.log',
			scope: 'todo-rendering',
		} );

		logger.log( 'todo_tool_use_received', { input: 'test' } );

		expect( logger.enabled ).toBe( false );
		expect( logger.path ).toBe( '/tmp/studio-tests/studio-ai-debug.log' );
		expect( appendFileSync ).not.toHaveBeenCalled();
	} );

	it( 'writes JSONL entries when enabled', async () => {
		process.env.STUDIO_AI_DEBUG = ' TRUE ';

		const { createDebugLogger } = await import( '../debug-log' );
		const logger = createDebugLogger( {
			enabledEnvVar: 'STUDIO_AI_DEBUG',
			defaultFilename: 'studio-ai-debug.log',
			scope: 'todo-rendering',
		} );

		logger.log( 'todo_tool_use_received', { input: 'test' } );

		expect( logger.enabled ).toBe( true );
		expect( appendFileSync ).toHaveBeenCalledWith(
			'/tmp/studio-tests/studio-ai-debug.log',
			JSON.stringify( {
				timestamp: '2026-03-12T10:00:00.000Z',
				scope: 'todo-rendering',
				event: 'todo_tool_use_received',
				payload: { input: 'test' },
			} ) + '\n'
		);
	} );

	it( 'uses the derived file override env var by default', async () => {
		process.env.STUDIO_AI_DEBUG = '1';
		process.env.STUDIO_AI_DEBUG_FILE = '/tmp/custom-debug.log';

		const { createDebugLogger } = await import( '../debug-log' );
		const logger = createDebugLogger( {
			enabledEnvVar: 'STUDIO_AI_DEBUG',
			defaultFilename: 'studio-ai-debug.log',
		} );

		logger.log( 'todo_tool_use_received' );

		expect( logger.path ).toBe( '/tmp/custom-debug.log' );
		expect( appendFileSync ).toHaveBeenCalledWith(
			'/tmp/custom-debug.log',
			JSON.stringify( {
				timestamp: '2026-03-12T10:00:00.000Z',
				scope: undefined,
				event: 'todo_tool_use_received',
				payload: undefined,
			} ) + '\n'
		);
	} );

	it( 'uses an explicit log file env var override when provided', async () => {
		process.env.STUDIO_AI_DEBUG = '1';
		process.env.STUDIO_AI_LOG_PATH = '/tmp/explicit-debug.log';

		const { createDebugLogger } = await import( '../debug-log' );
		const logger = createDebugLogger( {
			enabledEnvVar: 'STUDIO_AI_DEBUG',
			defaultFilename: 'studio-ai-debug.log',
			logFileEnvVar: 'STUDIO_AI_LOG_PATH',
		} );

		expect( logger.path ).toBe( '/tmp/explicit-debug.log' );
	} );
} );
