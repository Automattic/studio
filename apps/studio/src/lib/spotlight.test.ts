import { openDeeplink } from 'src/lib/deeplink';
import { buildStudioActionLink } from 'src/lib/deeplink/studio-action-link';
import { getSites } from 'src/lib/sites';
import { replaceSpotlightEntries } from 'src/lib/spotlight-native';

const { electronApp } = vi.hoisted( () => ( { electronApp: { isPackaged: true, on: vi.fn() } } ) );
vi.mock( 'electron', () => ( { app: electronApp } ) );
vi.mock( 'src/lib/deeplink', () => ( { openDeeplink: vi.fn() } ) );
vi.mock( 'src/lib/sites', () => ( { getSites: vi.fn() } ) );
vi.mock( 'src/lib/spotlight-native', () => ( { replaceSpotlightEntries: vi.fn() } ) );

let spotlight: typeof import('./spotlight');

beforeEach( async () => {
	vi.resetModules();
	vi.clearAllMocks();
	vi.stubGlobal( 'process', { ...process, platform: 'darwin' } );
	electronApp.isPackaged = true;
	vi.mocked( getSites ).mockResolvedValue( [] );
	vi.mocked( replaceSpotlightEntries ).mockResolvedValue();
	spotlight = await import( './spotlight' );
} );

afterEach( () => vi.unstubAllGlobals() );

it( 'brands the new-site action and keeps existing site titles concise', () => {
	const entries = spotlight.getSpotlightEntries( [ { id: 'one', name: 'My Portfolio' } ] );
	expect( entries.map( ( entry ) => entry.title ) ).toEqual( [
		'New WordPress Studio Site',
		'Open My Portfolio',
	] );
	expect( entries.every( ( entry ) => entry.description === 'WordPress Studio' ) ).toBe( true );
	expect( entries[ 1 ].keywords ).toEqual(
		expect.arrayContaining( [ 'WordPress Studio', 'My Portfolio' ] )
	);
} );

it( 'refreshes renamed and deleted sites and skips an unchanged index', async () => {
	vi.mocked( getSites ).mockResolvedValue( [ { id: 'one', name: 'Before' } ] as never );
	await spotlight.refreshSpotlightIndex();
	await spotlight.refreshSpotlightIndex();
	expect( replaceSpotlightEntries ).toHaveBeenCalledTimes( 1 );
	vi.mocked( getSites ).mockResolvedValue( [ { id: 'one', name: 'After' } ] as never );
	await spotlight.refreshSpotlightIndex();
	expect( replaceSpotlightEntries ).toHaveBeenLastCalledWith(
		expect.stringContaining( 'Open After' )
	);
	vi.mocked( getSites ).mockResolvedValue( [] );
	await spotlight.refreshSpotlightIndex();
	expect( JSON.parse( vi.mocked( replaceSpotlightEntries ).mock.lastCall![ 0 ] ) ).toHaveLength(
		1
	);
} );

it( 'retries a failed native update without rejecting app startup', async () => {
	const warning = vi.spyOn( console, 'warn' ).mockImplementation( () => {} );
	vi.mocked( replaceSpotlightEntries ).mockRejectedValueOnce( new Error( 'Unavailable' ) );
	await spotlight.refreshSpotlightIndex();
	await spotlight.refreshSpotlightIndex();
	expect( replaceSpotlightEntries ).toHaveBeenCalledTimes( 2 );
	expect( warning ).toHaveBeenCalled();
	warning.mockRestore();
} );

it.each( [ 'win32', 'linux' ] )( 'does not load the native bridge on %s', async ( platform ) => {
	vi.stubGlobal( 'process', { ...process, platform } );
	await spotlight.refreshSpotlightIndex();
	expect( replaceSpotlightEntries ).not.toHaveBeenCalled();
	expect( getSites ).not.toHaveBeenCalled();
} );

it( 'does not register entries belonging to a development Electron bundle', async () => {
	electronApp.isPackaged = false;
	await spotlight.refreshSpotlightIndex();
	expect( replaceSpotlightEntries ).not.toHaveBeenCalled();
} );

it( 'routes a Spotlight continuation through the startup queue', () => {
	spotlight.setupSpotlight();
	const callback = electronApp.on.mock.calls.find(
		( [ name ] ) => name === 'continue-activity'
	)![ 1 ];
	const event = { preventDefault: vi.fn() };
	const url = buildStudioActionLink( { action: 'open-site', siteId: 'one' } );
	( callback as ( ...args: unknown[] ) => void )( event, 'com.apple.corespotlightitem', {
		kCSSearchableItemActivityIdentifier: url,
	} );
	expect( event.preventDefault ).toHaveBeenCalled();
	expect( openDeeplink ).toHaveBeenCalledWith( url );
	vi.mocked( openDeeplink ).mockClear();
	( callback as ( ...args: unknown[] ) => void )( event, 'com.apple.corespotlightitem', {
		kCSSearchableItemActivityIdentifier: 'https://example.com',
	} );
	expect( openDeeplink ).not.toHaveBeenCalled();
} );
