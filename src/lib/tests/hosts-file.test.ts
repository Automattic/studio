import { readFile, writeFile } from 'fs';
import { addDomainToHosts, removeDomainFromHosts } from '../hosts-file';

const readFileCallbackMock = jest.fn();

jest.mock( 'fs', () => ( {
	readFile: jest.fn( ( path, encoding, callback ) => {
		callback( null, readFileCallbackMock() );
	} ),
	writeFile: jest.fn( ( path, data, callback ) => {
		callback( null );
	} ),
} ) );

jest.mock( 'sudo-prompt', () => {
	return {
		exec: jest.fn( ( command, options, callback ) => {
			callback( null, 'Mocked output' );
		} ),
	};
} );

jest.spyOn( console, 'error' ).mockImplementation( () => {} );

describe( 'hosts-file', () => {
	// Sample hosts file content for testing
	const sampleHostsContent = `127.0.0.1 localhost
::1 localhost

# Some comment

# BEGIN WordPress Studio
127.0.0.1 foo.wp.cloud # Port 8000 (WordPress Studio)
127.0.0.1 bar.wp.cloud # Port 8001 (WordPress Studio)
# END WordPress Studio

# Other entries
192.168.1.1 router`;

	// Setup before each test
	beforeEach( () => {
		jest.clearAllMocks();
	} );

	describe( 'addDomainToHosts', () => {
		it( 'should add a new domain to the hosts file', async () => {
			readFileCallbackMock.mockResolvedValueOnce( sampleHostsContent );

			await addDomainToHosts( 'new-domain.wp.cloud', 8002 );

			expect( readFile ).toHaveBeenCalled();
			expect( writeFile ).toHaveBeenCalled();

			const newContent = ( writeFile as unknown as jest.Mock ).mock.calls[ 0 ][ 1 ];

			expect( newContent ).toEqual(
				`127.0.0.1 localhost
::1 localhost

# Some comment

# BEGIN WordPress Studio
127.0.0.1 foo.wp.cloud # Port 8000 (WordPress Studio)
127.0.0.1 bar.wp.cloud # Port 8001 (WordPress Studio)
127.0.0.1 new-domain.wp.cloud # Port 8002 (WordPress Studio)
# END WordPress Studio

# Other entries
192.168.1.1 router`
			);
		} );

		it( 'should not add duplicate domains', async () => {
			readFileCallbackMock.mockResolvedValueOnce( sampleHostsContent );
			await addDomainToHosts( 'foo.wp.cloud', 8000 );
			expect( readFile ).toHaveBeenCalled();
			expect( writeFile ).not.toHaveBeenCalled();
		} );

		it( 'should create a new WordPress Studio block if none exists', async () => {
			// Content without a WordPress Studio block
			const contentWithoutBlock = `127.0.0.1 localhost
::1 localhost

# Some other entries
192.168.1.1 router`;

			readFileCallbackMock.mockResolvedValueOnce( contentWithoutBlock );

			await addDomainToHosts( 'new-domain.wp.cloud', 8002 );

			expect( writeFile ).toHaveBeenCalled();

			const newContent = ( writeFile as unknown as jest.Mock ).mock.calls[ 0 ][ 1 ];
			expect( newContent ).toEqual( `127.0.0.1 localhost
::1 localhost

# Some other entries
192.168.1.1 router

# BEGIN WordPress Studio
127.0.0.1 new-domain.wp.cloud # Port 8002 (WordPress Studio)
# END WordPress Studio` );
		} );

		it( 'should handle errors when reading the hosts file', async () => {
			readFileCallbackMock.mockRejectedValueOnce( new Error( 'Failed to read file' ) );

			await expect( addDomainToHosts( 'new-domain.wp.cloud', 8002 ) ).rejects.toThrow(
				'Failed to read file'
			);

			expect( readFile ).toHaveBeenCalled();
			expect( writeFile ).not.toHaveBeenCalled();
		} );
	} );

	describe( 'removeDomainFromHosts', () => {
		it( 'should remove an existing domain from the hosts file', async () => {
			readFileCallbackMock.mockResolvedValueOnce( sampleHostsContent );

			await removeDomainFromHosts( 'foo.wp.cloud' );

			expect( readFile ).toHaveBeenCalled();
			expect( writeFile ).toHaveBeenCalled();

			const newContent = ( writeFile as unknown as jest.Mock ).mock.calls[ 0 ][ 1 ];

			expect( newContent ).not.toContain( '127.0.0.1 foo.wp.cloud' );
			expect( newContent ).toContain( '127.0.0.1 bar.wp.cloud' );
		} );

		it( 'should not modify the hosts file if domain not found', async () => {
			readFileCallbackMock.mockResolvedValueOnce( sampleHostsContent );

			await removeDomainFromHosts( 'nonexistent.wp.cloud' );

			expect( readFile ).toHaveBeenCalled();
			expect( writeFile ).not.toHaveBeenCalled();
		} );

		it( 'should remove the entire WordPress Studio block if all domains are removed', async () => {
			const contentWithSingleDomain = `127.0.0.1 localhost
::1 localhost

# BEGIN WordPress Studio
127.0.0.1 foo.wp.cloud # Port 8000 (WordPress Studio)
# END WordPress Studio`;

			readFileCallbackMock.mockResolvedValueOnce( contentWithSingleDomain );

			await removeDomainFromHosts( 'foo.wp.cloud' );

			expect( writeFile ).toHaveBeenCalled();

			const newContent = ( writeFile as unknown as jest.Mock ).mock.calls[ 0 ][ 1 ];

			expect( newContent.trim() ).toEqual( '127.0.0.1 localhost\n::1 localhost' );
		} );

		it( 'should handle errors when reading the hosts file', async () => {
			readFileCallbackMock.mockRejectedValueOnce( new Error( 'Read error' ) );

			await expect( removeDomainFromHosts( 'test.wp.cloud' ) ).rejects.toThrow( 'Read error' );
		} );
	} );
} );
