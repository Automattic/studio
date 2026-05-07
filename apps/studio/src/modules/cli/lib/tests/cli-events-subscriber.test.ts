/**
 * @vitest-environment node
 */
import EventEmitter from 'node:events';
import { SITE_EVENTS } from '@studio/common/lib/cli-events';
import { vi } from 'vitest';

let emitter: EventEmitter;
const mockExecuteCliCommand = vi.fn();
const mockSendIpcEventToRenderer = vi.fn().mockResolvedValue( undefined );
const mockCaptureSiteThumbnail = vi.fn().mockResolvedValue( undefined );
const mockScheduleLocalAdminChecksRefresh = vi.fn().mockResolvedValue( undefined );
const mockRegister = vi.fn();
const mockGet = vi.fn();
const mockGetByPath = vi.fn();

vi.mock( 'src/modules/cli/lib/execute-command', () => ( {
	executeCliCommand: mockExecuteCliCommand,
} ) );
vi.mock( 'src/ipc-utils', () => ( {
	sendIpcEventToRenderer: mockSendIpcEventToRenderer,
} ) );
vi.mock( 'src/lib/capture-site-thumbnail', () => ( {
	captureSiteThumbnail: mockCaptureSiteThumbnail,
} ) );
vi.mock( 'src/lib/site-maintenance-tasks', () => ( {
	scheduleLocalAdminChecksRefresh: mockScheduleLocalAdminChecksRefresh,
} ) );
vi.mock( 'src/site-server', () => ( {
	SiteServer: {
		get: mockGet,
		getByPath: mockGetByPath,
		register: mockRegister,
		unregister: vi.fn(),
	},
} ) );

function siteEventData( event: SITE_EVENTS, running: boolean ) {
	return {
		action: 'keyValuePair',
		key: 'site-event',
		value: JSON.stringify( {
			event,
			siteId: 'site-1',
			running,
			site: {
				id: 'site-1',
				name: 'Site 1',
				path: '/site-1',
				port: 9999,
				url: 'http://localhost:9999',
				phpVersion: '8.4',
			},
		} ),
	};
}

async function startSubscriber() {
	emitter = new EventEmitter();
	mockExecuteCliCommand.mockReturnValue( [ emitter, { kill: vi.fn() } ] );
	const subscriber = await import( 'src/modules/cli/lib/cli-events-subscriber' );
	const started = subscriber.startCliEventsSubscriber();
	emitter.emit( 'started' );
	await started;
	return subscriber;
}

describe( 'cli-events-subscriber background work', () => {
	beforeEach( () => {
		vi.resetModules();
		vi.clearAllMocks();
	} );

	it( 'schedules thumbnail capture and local admin refresh for created running sites', async () => {
		const server = { details: { id: 'site-1', running: true } };
		mockRegister.mockReturnValue( server );

		await startSubscriber();
		emitter.emit( 'data', { data: siteEventData( SITE_EVENTS.CREATED, true ) } );
		await Promise.resolve();

		expect( mockCaptureSiteThumbnail ).toHaveBeenCalledWith( 'site-1' );
		expect( mockScheduleLocalAdminChecksRefresh ).toHaveBeenCalledWith( server, 'site-created' );
	} );

	it( 'schedules thumbnail capture and local admin refresh when a site starts', async () => {
		const server = {
			details: { id: 'site-1', running: false },
			server: {},
			getThemeDetails: vi.fn().mockResolvedValue( undefined ),
			getSiteIcon: vi.fn().mockResolvedValue( undefined ),
		};
		mockGet.mockReturnValue( server );

		await startSubscriber();
		emitter.emit( 'data', { data: siteEventData( SITE_EVENTS.UPDATED, true ) } );
		await Promise.resolve();
		await Promise.resolve();

		expect( mockCaptureSiteThumbnail ).toHaveBeenCalledWith( 'site-1' );
		expect( mockScheduleLocalAdminChecksRefresh ).toHaveBeenCalledWith( server, 'site-started' );
		expect( server.getThemeDetails ).toHaveBeenCalled();
		expect( server.getSiteIcon ).toHaveBeenCalled();
	} );
} );
