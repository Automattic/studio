import fs from 'fs';
import os from 'os';
import path from 'path';
import nock from 'nock';
import { PreviewCreateCommand } from 'cli/commands/preview/create';

jest.mock( 'fs' );

describe( 'PreviewCreateCommand', () => {
	let command: PreviewCreateCommand;
	const mockFolder = '/test/folder';
	const mockArchivePath = path.join( os.tmpdir(), `${ mockFolder }.zip` );

	beforeEach( () => {
		jest.clearAllMocks();
		nock.cleanAll();
		command = new PreviewCreateCommand( mockFolder, 'json' );
	} );

	describe( 'run', () => {
		it( 'should complete the preview creation process successfully', async () => {
			const mockWriteStream = {
				on: jest.fn( ( event, callback ) => {
					if ( event === 'close' ) {
						callback();
					}
				} ),
			};
			( fs.createWriteStream as jest.Mock ).mockReturnValue( mockWriteStream );

			nock( 'https://public-api.wordpress.com' )
				.post( '/rest/v1.1/jurassic-ninja/create-new-site-from-zip' )
				.reply( 200, { success: true } );

			( fs.unlinkSync as jest.Mock ).mockImplementation( () => {} );

			const result = await command.run();

			expect( result ).toBe( true );
			expect( fs.createWriteStream ).toHaveBeenCalledWith( mockArchivePath );
			expect( fs.unlinkSync ).toHaveBeenCalledWith( mockArchivePath );
		} );
	} );

	describe( 'archiveFolder', () => {
		it( 'should create an archive with the correct files', async () => {
			const mockWriteStream = {
				on: jest.fn( ( event, callback ) => {
					if ( event === 'close' ) {
						callback();
					}
				} ),
			};
			( fs.createWriteStream as jest.Mock ).mockReturnValue( mockWriteStream );

			await command.archiveFolder();

			expect( fs.createWriteStream ).toHaveBeenCalledWith( mockArchivePath );
		} );
	} );

	describe( 'uploadArchive', () => {
		it( 'should upload the archive to the correct endpoint', async () => {
			nock( 'https://public-api.wordpress.com' )
				.post( '/rest/v1.1/jurassic-ninja/create-new-site-from-zip' )
				.reply( 200, { success: true } );

			await command.uploadArchive();

			expect( nock.isDone() ).toBe( true );
		} );
	} );

	describe( 'cleanup', () => {
		it( 'should delete the archive file', async () => {
			await command.cleanup();
			expect( fs.unlinkSync ).toHaveBeenCalledWith( mockArchivePath );
		} );
	} );
} );
