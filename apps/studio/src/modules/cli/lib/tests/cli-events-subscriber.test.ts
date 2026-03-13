/**
 * @vitest-environment node
 */
import { EventEmitter } from 'node:events';
import { SITE_EVENTS } from '@studio/common/lib/site-events';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const sendIpcEventToRenderer = vi.fn();
const executeCliCommand = vi.fn();
const register = vi.fn();
const unregister = vi.fn();
const get = vi.fn();
const getByPath = vi.fn();

let currentEmitter: EventEmitter;
let currentChildProcess: { kill: ReturnType< typeof vi.fn > };

vi.mock( 'src/ipc-utils', () => ( {
	sendIpcEventToRenderer,
} ) );

vi.mock( 'src/modules/cli/lib/execute-command', () => ( {
	executeCliCommand,
} ) );

vi.mock( 'src/site-server', () => ( {
	SiteServer: {
		register,
		unregister,
		get,
		getByPath,
	},
} ) );

describe( 'cli-events-subscriber', () => {
	beforeEach( () => {
		vi.resetModules();
		vi.clearAllMocks();

		currentEmitter = new EventEmitter();
		currentChildProcess = { kill: vi.fn() };
		executeCliCommand.mockReturnValue( [ currentEmitter, currentChildProcess ] );
		get.mockReturnValue( undefined );
		getByPath.mockReturnValue( undefined );
		register.mockImplementation( ( details ) => ( {
			details,
			hasOngoingOperation: false,
			server: { url: details.url },
		} ) );
	} );

	it( 'registers missing sites from UPDATED events so external CLI starts appear in the app', async () => {
		const { startCliEventsSubscriber, stopCliEventsSubscriber } = await import(
			'src/modules/cli/lib/cli-events-subscriber'
		);

		const startPromise = startCliEventsSubscriber();
		currentEmitter.emit( 'started' );
		await startPromise;

		const siteEvent = {
			event: SITE_EVENTS.UPDATED,
			siteId: 'site-1',
			running: true,
			site: {
				id: 'site-1',
				name: 'AI Site',
				path: '/sites/ai-site',
				port: 8881,
				url: 'http://localhost:8881',
				phpVersion: '8.3',
			},
		};

		currentEmitter.emit( 'data', {
			data: {
				action: 'keyValuePair',
				key: 'site-event',
				value: JSON.stringify( siteEvent ),
			},
		} );

		await vi.waitFor( () => {
			expect( register ).toHaveBeenCalledWith( {
				...siteEvent.site,
				running: true,
			} );
		} );

		expect( sendIpcEventToRenderer ).toHaveBeenCalledWith( 'site-event', siteEvent );

		stopCliEventsSubscriber();
		expect( currentChildProcess.kill ).toHaveBeenCalledWith( 'SIGKILL' );
	} );
} );
