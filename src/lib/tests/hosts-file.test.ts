import { readFile, writeFile } from 'fs';
import { vi } from 'vitest';
import {
	addDomainToHosts,
	removeDomainFromHosts,
	updateDomainInHosts,
	createHostsEntryPattern,
} from '../hosts-file';

const readFileCallbackMock = vi.fn();

vi.mock( 'fs', () => {
	const mockReadFile = vi.fn().mockImplementation( ( path, encoding, callback ) => {
		callback( null, readFileCallbackMock() );
	} );
	const mockWriteFile = vi.fn().mockImplementation( ( path, data, callback ) => {
		callback( null );
	} );

	return {
		default: {
			readFile: mockReadFile,
			writeFile: mockWriteFile,
		},
		readFile: mockReadFile,
		writeFile: mockWriteFile,
	};
} );

vi.mock( '@vscode/sudo-prompt', () => {
	const mockExec = vi.fn().mockImplementation( ( command, options, callback ) => {
		callback( null, 'Mocked output' );
	} );
	return {
		default: {
			exec: mockExec,
		},
		exec: mockExec,
	};
} );

vi.spyOn( console, 'error' ).mockImplementation( () => {} );

describe( 'hosts-file', () => {
	// Sample hosts file content for testing
	const sampleHostsContent = `127.0.0.1 localhost
::1 localhost

# Some comment

# BEGIN WordPress Studio
127.0.0.1 foo.wp.cloud # Port 8000
127.0.0.1 bar.wp.cloud # Port 8001
# END WordPress Studio

# Other entries
192.168.1.1 router`;

	// Setup before each test
	beforeEach( () => {
		vi.clearAllMocks();
	} );

	describe( 'addDomainToHosts', () => {
		it( 'should add a new domain to the hosts file', async () => {
			readFileCallbackMock.mockResolvedValueOnce( sampleHostsContent );

			await addDomainToHosts( 'new-domain.wp.cloud', 8002 );

			expect( readFile ).toHaveBeenCalled();
			expect( writeFile ).toHaveBeenCalled();

			const newContent = vi.mocked( writeFile ).mock.calls[ 0 ][ 1 ];

			expect( newContent ).toEqual(
				`127.0.0.1 localhost
::1 localhost

# Some comment

# BEGIN WordPress Studio
127.0.0.1 foo.wp.cloud # Port 8000
127.0.0.1 bar.wp.cloud # Port 8001
127.0.0.1 new-domain.wp.cloud # Port 8002
# END WordPress Studio

# Other entries
192.168.1.1 router`
			);
		} );

		it( 'should add a new domain with special characters', async () => {
			readFileCallbackMock.mockResolvedValueOnce( sampleHostsContent );

			await addDomainToHosts( 'münchen.local', 8002 );

			expect( readFile ).toHaveBeenCalled();
			expect( writeFile ).toHaveBeenCalled();

			const newContent = vi.mocked( writeFile ).mock.calls[ 0 ][ 1 ];

			expect( newContent ).toEqual(
				`127.0.0.1 localhost
::1 localhost

# Some comment

# BEGIN WordPress Studio
127.0.0.1 foo.wp.cloud # Port 8000
127.0.0.1 bar.wp.cloud # Port 8001
127.0.0.1 xn--mnchen-3ya.local # Port 8002
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

			const newContent = vi.mocked( writeFile ).mock.calls[ 0 ][ 1 ];
			expect( newContent ).toEqual( `127.0.0.1 localhost
::1 localhost

# Some other entries
192.168.1.1 router

# BEGIN WordPress Studio
127.0.0.1 new-domain.wp.cloud # Port 8002
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

	describe( 'createHostsEntryPattern', () => {
		it( 'should remove backslashes as a security measure', () => {
			const pattern = createHostsEntryPattern( 'test\\backslash.wp.cloud' );
			const expectedPattern = /127\.0\.0\.1\s+testbackslash\.wp\.cloud(\s|$)/i;

			expect( pattern.source ).toBe( expectedPattern.source );
			expect( pattern.flags ).toBe( expectedPattern.flags );
		} );

		it( 'should escape dots and other regex special characters', () => {
			const pattern = createHostsEntryPattern( 'test.example.com' );
			const expectedPattern = /127\.0\.0\.1\s+test\.example\.com(\s|$)/i;

			expect( pattern.source ).toBe( expectedPattern.source );
			expect( pattern.flags ).toBe( expectedPattern.flags );
		} );

		it( 'should handle domains with multiple backslashes', () => {
			const pattern = createHostsEntryPattern( 'test\\\\backslash.wp.cloud' );
			const expectedPattern = /127\.0\.0\.1\s+testbackslash\.wp\.cloud(\s|$)/i;

			expect( pattern.source ).toBe( expectedPattern.source );
			expect( pattern.flags ).toBe( expectedPattern.flags );
		} );

		it( 'should escape other regex special characters', () => {
			const pattern = createHostsEntryPattern( 'test+example*com' );
			const expectedPattern = /127\.0\.0\.1\s+test\+example\*com(\s|$)/i;

			expect( pattern.source ).toBe( expectedPattern.source );
			expect( pattern.flags ).toBe( expectedPattern.flags );
		} );
	} );

	describe( 'removeDomainFromHosts', () => {
		it( 'should remove an existing domain from the hosts file', async () => {
			readFileCallbackMock.mockResolvedValueOnce( sampleHostsContent );

			await removeDomainFromHosts( 'foo.wp.cloud' );

			expect( readFile ).toHaveBeenCalled();
			expect( writeFile ).toHaveBeenCalled();

			const newContent = vi.mocked( writeFile ).mock.calls[ 0 ][ 1 ];

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
127.0.0.1 foo.wp.cloud # Port 8000
# END WordPress Studio`;

			readFileCallbackMock.mockResolvedValueOnce( contentWithSingleDomain );

			await removeDomainFromHosts( 'foo.wp.cloud' );

			expect( writeFile ).toHaveBeenCalled();

			const newContent = vi.mocked( writeFile ).mock.calls[ 0 ][ 1 ] as string;

			expect( newContent.trim() ).toEqual( '127.0.0.1 localhost\n::1 localhost' );
		} );

		it( 'should handle errors when reading the hosts file', async () => {
			readFileCallbackMock.mockRejectedValueOnce( new Error( 'Read error' ) );

			await expect( removeDomainFromHosts( 'test.wp.cloud' ) ).rejects.toThrow( 'Read error' );
		} );
	} );

	describe( 'updateDomainInHosts', () => {
		it( 'should replace an existing domain with a new domain', async () => {
			readFileCallbackMock.mockResolvedValueOnce( sampleHostsContent );

			await updateDomainInHosts( 'foo.wp.cloud', 'new-domain.wp.cloud', 8002 );

			expect( readFile ).toHaveBeenCalled();
			expect( writeFile ).toHaveBeenCalled();

			const newContent = vi.mocked( writeFile ).mock.calls[ 0 ][ 1 ];

			expect( newContent ).toEqual(
				`127.0.0.1 localhost
::1 localhost

# Some comment

# BEGIN WordPress Studio
127.0.0.1 bar.wp.cloud # Port 8001
127.0.0.1 new-domain.wp.cloud # Port 8002
# END WordPress Studio

# Other entries
192.168.1.1 router`
			);
		} );

		it( 'should add a new domain if old domain is undefined', async () => {
			readFileCallbackMock.mockResolvedValueOnce( sampleHostsContent );

			await updateDomainInHosts( undefined, 'new-domain.wp.cloud', 8002 );

			expect( readFile ).toHaveBeenCalled();
			expect( writeFile ).toHaveBeenCalled();

			const newContent = vi.mocked( writeFile ).mock.calls[ 0 ][ 1 ];

			expect( newContent ).toEqual(
				`127.0.0.1 localhost
::1 localhost

# Some comment

# BEGIN WordPress Studio
127.0.0.1 foo.wp.cloud # Port 8000
127.0.0.1 bar.wp.cloud # Port 8001
127.0.0.1 new-domain.wp.cloud # Port 8002
# END WordPress Studio

# Other entries
192.168.1.1 router`
			);
		} );

		it( 'should remove the old domain if new domain is undefined', async () => {
			readFileCallbackMock.mockResolvedValueOnce( sampleHostsContent );

			await updateDomainInHosts( 'foo.wp.cloud', undefined, 8000 );

			expect( readFile ).toHaveBeenCalled();
			expect( writeFile ).toHaveBeenCalled();

			const newContent = vi.mocked( writeFile ).mock.calls[ 0 ][ 1 ];

			expect( newContent ).toEqual(
				`127.0.0.1 localhost
::1 localhost

# Some comment

# BEGIN WordPress Studio
127.0.0.1 bar.wp.cloud # Port 8001
# END WordPress Studio

# Other entries
192.168.1.1 router`
			);
		} );

		it( 'should not modify the hosts file if old and new domains are the same', async () => {
			readFileCallbackMock.mockResolvedValueOnce( sampleHostsContent );

			await updateDomainInHosts( 'foo.wp.cloud', 'foo.wp.cloud', 8000 );

			expect( readFile ).not.toHaveBeenCalled();
			expect( writeFile ).not.toHaveBeenCalled();
		} );
	} );
} );
