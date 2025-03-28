import { portFinder } from '../port-finder';
import { simpleServer } from '../simple-server';

jest.mock( '../../lib/port-finder' );

describe( 'SimpleServer', () => {
	beforeEach( async () => {
		jest.clearAllMocks();
		( portFinder.getOpenPort as jest.Mock ).mockResolvedValue( 3000 );
		await simpleServer.stop();
	} );

	afterEach( async () => {
		await simpleServer.stop();
	} );

	it( 'should start a server on an available port', async () => {
		const port = await simpleServer.start();
		expect( port ).toBe( 3000 );
		expect( portFinder.getOpenPort ).toHaveBeenCalled();
	} );

	it( 'should stop the server and release the port', async () => {
		await simpleServer.start();
		await simpleServer.stop();
		expect( portFinder.releasePort ).toHaveBeenCalledWith( 3000 );
	}, 10000 );

	it( 'should handle multiple start/stop cycles', async () => {
		// First cycle
		await simpleServer.start();
		await simpleServer.stop();

		// Second cycle
		await simpleServer.start();
		await simpleServer.stop();

		expect( portFinder.getOpenPort ).toHaveBeenCalledTimes( 2 );
		expect( portFinder.releasePort ).toHaveBeenCalledTimes( 2 );
	}, 10000 );
} );
