// To run tests, execute `npm run test -- src/lib/tests/import-export/import/handlers/backup-handler.test.ts``
import fs from 'fs';
import fsPromises from 'fs/promises';
import path from 'path';
import zlib from 'zlib';
import AdmZip from 'adm-zip';
import * as tar from 'tar';
import { BackupHandler } from '../../../../import-export/import/handlers/BackupHandler';
import { BackupArchiveInfo } from '../../../../import-export/import/types';

jest.mock( 'fs' );
jest.mock( 'fs/promises' );
jest.mock( 'zlib' );
jest.mock( 'tar' );
jest.mock( 'adm-zip' );
jest.mock( 'path' );

describe( 'BackupHandler', () => {
	const handler = new BackupHandler();

	beforeEach( () => {
		jest.clearAllMocks();
	} );

	describe( 'listFiles', () => {
		it( 'should list files from a gzip archive', async () => {
			const archiveInfo: BackupArchiveInfo = {
				path: '/path/to/backup.tar.gz',
				type: 'application/gzip',
			};

			( path.extname as jest.Mock ).mockReturnValue( '.gz' );
			( tar.t as unknown as jest.Mock ).mockImplementation( ( { onReadEntry } ) => {
				onReadEntry( { path: 'file1.txt' } );
				onReadEntry( { path: 'file2.txt' } );
				return Promise.resolve();
			} );

			const result = await handler.listFiles( archiveInfo );
			expect( result ).toEqual( [ 'file1.txt', 'file2.txt' ] );
		} );

		it( 'should list files from a zip archive', async () => {
			const archiveInfo: BackupArchiveInfo = {
				path: '/path/to/backup.zip',
				type: 'application/zip',
			};

			( path.extname as jest.Mock ).mockReturnValue( '.zip' );
			( AdmZip as jest.Mock ).mockImplementation( () => ( {
				getEntries: () => [ { entryName: 'file1.txt' }, { entryName: 'file2.txt' } ],
			} ) );

			const result = await handler.listFiles( archiveInfo );
			expect( result ).toEqual( [ 'file1.txt', 'file2.txt' ] );
		} );
	} );

	describe( 'extractFiles', () => {
		it( 'should extract files from a gzip archive', async () => {
			const archiveInfo: BackupArchiveInfo = {
				path: '/path/to/backup.tar.gz',
				type: 'application/gzip',
			};
			const extractionDirectory = '/tmp/extracted';

			( path.extname as jest.Mock ).mockReturnValue( '.gz' );
			( fsPromises.mkdir as jest.Mock ).mockResolvedValue( undefined );
			( fs.createReadStream as jest.Mock ).mockReturnValue( {
				pipe: jest.fn().mockReturnThis(),
				on: jest.fn().mockImplementation( ( event, callback ) => {
					if ( event === 'finish' ) {
						callback();
					}
					return this;
				} ),
			} );
			( zlib.createGunzip as jest.Mock ).mockReturnValue( {
				pipe: jest.fn().mockReturnThis(),
			} );
			( tar.extract as unknown as jest.Mock ).mockReturnValue( {
				on: jest.fn().mockImplementation( ( event, callback ) => {
					if ( event === 'finish' ) {
						callback();
					}
					return this;
				} ),
			} );

			await expect(
				handler.extractFiles( archiveInfo, extractionDirectory )
			).resolves.not.toThrow();
		} );

		it( 'should extract files from a zip archive', async () => {
			const archiveInfo: BackupArchiveInfo = {
				path: '/path/to/backup.zip',
				type: 'application/zip',
			};
			const extractionDirectory = '/tmp/extracted';

			( path.extname as jest.Mock ).mockReturnValue( '.zip' );
			( fsPromises.mkdir as jest.Mock ).mockResolvedValue( undefined );

			const mockExtractAllToAsync = jest
				.fn()
				.mockImplementation( ( _path, _overwrite, _keepOriginalPermission, callback ) => {
					callback();
				} );

			( AdmZip as jest.Mock ).mockImplementation( () => ( {
				extractAllToAsync: mockExtractAllToAsync,
			} ) );

			await expect(
				handler.extractFiles( archiveInfo, extractionDirectory )
			).resolves.not.toThrow();

			expect( mockExtractAllToAsync ).toHaveBeenCalledWith(
				extractionDirectory,
				true,
				undefined,
				expect.any( Function )
			);
		} );
	} );
} );
