// To run tests, execute `npm run test -- src/lib/import-export/tests/import/handlers/backup-handler-factory.test.ts`
import fs from 'fs';
import path from 'path';
import AdmZip from 'adm-zip';
import * as tar from 'tar';
import { BackupHandlerFactory } from '../../../import/handlers/backup-handler-factory';
import { BackupHandlerSql } from '../../../import/handlers/backup-handler-sql';
import { BackupHandlerTarGz } from '../../../import/handlers/backup-handler-tar-gz';
import { BackupHandlerZip } from '../../../import/handlers/backup-handler-zip';
import { BackupArchiveInfo } from '../../../import/types';

jest.mock( 'fs' );
jest.mock( 'fs/promises' );
jest.mock( 'zlib' );
jest.mock( 'tar' );
jest.mock( 'adm-zip' );
jest.mock( 'path' );

describe( 'BackupHandlerFactory', () => {
	beforeEach( () => {
		jest.clearAllMocks();
	} );

	describe( 'create', () => {
		it( 'should create a handler for gzip archives', () => {
			const archiveInfo: BackupArchiveInfo = {
				path: '/path/to/backup.tar.gz',
				type: 'application/gzip',
			};
			( path.extname as jest.Mock ).mockReturnValue( '.gz' );
			const handler = BackupHandlerFactory.create( archiveInfo );
			expect( handler ).toBeInstanceOf( BackupHandlerTarGz );
		} );

		it( 'should create a handler for zip archives', () => {
			const archiveInfo: BackupArchiveInfo = {
				path: '/path/to/backup.zip',
				type: 'application/zip',
			};
			( path.extname as jest.Mock ).mockReturnValue( '.zip' );
			const handler = BackupHandlerFactory.create( archiveInfo );
			expect( handler ).toBeInstanceOf( BackupHandlerZip );
		} );

		it( 'should create a handler for SQL files', () => {
			const archiveInfo: BackupArchiveInfo = {
				path: '/path/to/backup.sql',
				type: 'application/sql',
			};
			( path.extname as jest.Mock ).mockReturnValue( '.sql' );
			const handler = BackupHandlerFactory.create( archiveInfo );
			expect( handler ).toBeInstanceOf( BackupHandlerSql );
		} );

		it( 'should throw an error for unsupported file types', () => {
			const archiveInfo: BackupArchiveInfo = {
				path: '/path/to/backup.unknown',
				type: 'application/unknown',
			};
			( path.extname as jest.Mock ).mockReturnValue( '.unknown' );
			expect( () => BackupHandlerFactory.create( archiveInfo ) ).toThrow(
				'Unsupported file format'
			);
		} );
	} );

	describe( 'listFiles', () => {
		const archiveFiles = [
			'index.php',
			'wp-content/plugins/hello.php',
			'wp-content/themes/twentytwentyfour/theme.json',
			'wp-content/uploads/2024/07/image.png',
		];

		it( 'should list files from a gzip archive', async () => {
			const archiveInfo: BackupArchiveInfo = {
				path: '/path/to/backup.tar.gz',
				type: 'application/gzip',
			};
			const handler = BackupHandlerFactory.create( archiveInfo );

			jest.spyOn( tar, 't' ).mockImplementation( ( { onReadEntry } ) => {
				archiveFiles.forEach( ( path ) => onReadEntry?.( { path } as tar.ReadEntry ) );
			} );

			await expect( handler.listFiles( archiveInfo ) ).resolves.toEqual( archiveFiles );
		} );

		it( 'should list files from a zip archive', async () => {
			const archiveInfo: BackupArchiveInfo = {
				path: '/path/to/backup.zip',
				type: 'application/zip',
			};
			const handler = BackupHandlerFactory.create( archiveInfo );

			( AdmZip as jest.Mock ).mockReturnValue( {
				getEntries: jest
					.fn()
					.mockReturnValue( archiveFiles.map( ( file ) => ( { entryName: file } ) ) ),
			} );

			await expect( handler.listFiles( archiveInfo ) ).resolves.toEqual( archiveFiles );
		} );

		it( 'should list a single SQL file', async () => {
			const archiveInfo: BackupArchiveInfo = {
				path: '/path/to/backup.sql',
				type: 'application/sql',
			};
			const handler = BackupHandlerFactory.create( archiveInfo );
			( path.basename as jest.Mock ).mockReturnValue( 'backup.sql' );
			const result = await handler.listFiles( archiveInfo );
			expect( result ).toEqual( [ 'backup.sql' ] );
		} );
	} );

	describe( 'extractFiles', () => {
		it( 'should extract files from a gzip archive', async () => {
			const archiveInfo: BackupArchiveInfo = {
				path: '/path/to/backup.tar.gz',
				type: 'application/gzip',
			};
			const handler = BackupHandlerFactory.create( archiveInfo );
			const extractionDirectory = '/tmp/extracted';

			( fs.createReadStream as jest.Mock ).mockReturnValue( {
				pipe: jest.fn().mockReturnThis(),
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
			expect( tar.x ).toHaveBeenCalledWith( {
				cwd: extractionDirectory,
			} );
		} );

		it( 'should extract files from a zip archive', async () => {
			const archiveInfo: BackupArchiveInfo = {
				path: '/path/to/backup.zip',
				type: 'application/zip',
			};
			const handler = BackupHandlerFactory.create( archiveInfo );
			const extractionDirectory = '/tmp/extracted';
			const mockExtractAllToAsync = jest
				.fn()
				.mockImplementation( ( path, overwrite, keepOriginalPermission, callback ) => {
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

		it( 'should copy SQL file to extraction directory', async () => {
			const archiveInfo: BackupArchiveInfo = {
				path: '/path/to/backup.sql',
				type: 'application/sql',
			};
			const handler = BackupHandlerFactory.create( archiveInfo );
			const extractionDirectory = '/tmp/extracted';
			( path.basename as jest.Mock ).mockReturnValue( 'backup.sql' );
			( fs.promises.copyFile as jest.Mock ).mockResolvedValue( undefined );

			await expect(
				handler.extractFiles( archiveInfo, extractionDirectory )
			).resolves.not.toThrow();
			expect( fs.promises.copyFile ).toHaveBeenCalledWith(
				archiveInfo.path,
				path.join( extractionDirectory, 'backup.sql' )
			);
		} );
	} );
} );
