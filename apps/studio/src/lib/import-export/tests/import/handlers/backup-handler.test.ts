// To run tests, execute `npm run test -- src/lib/import-export/tests/import/handlers/backup-handler-factory.test.ts`
import fs from 'fs';
import path from 'path';
import { Readable } from 'stream';
import fse from 'fs-extra';
import * as tar from 'tar';
import { vi, Mock } from 'vitest';
import * as yauzl from 'yauzl';
import { BackupHandlerFactory } from 'src/lib/import-export/import/handlers/backup-handler-factory';
import { BackupHandlerSql } from 'src/lib/import-export/import/handlers/backup-handler-sql';
import { BackupHandlerTarGz } from 'src/lib/import-export/import/handlers/backup-handler-tar-gz';
import { BackupHandlerZip } from 'src/lib/import-export/import/handlers/backup-handler-zip';
import { BackupArchiveInfo } from 'src/lib/import-export/import/types';
import { createMock } from 'src/lib/test-utils';

vi.mock( 'fs' );
vi.mock( 'fs-extra', () => ( {
	default: {
		ensureDir: vi.fn(),
	},
	ensureDir: vi.fn(),
} ) );
vi.mock( 'zlib' );
vi.mock( 'tar' );
vi.mock( 'yauzl' );
vi.mock( 'path', () => ( {
	default: {
		extname: vi.fn(),
		basename: vi.fn(),
		join: vi.fn(),
		dirname: vi.fn(),
	},
	extname: vi.fn(),
	basename: vi.fn(),
	join: vi.fn(),
	dirname: vi.fn(),
} ) );

// Mock types to match yauzl and Node.js stream interfaces
interface MockZipFile {
	on: Mock;
	readEntry: Mock;
	openReadStream?: Mock;
}

interface MockReadStream extends Partial< Readable > {
	on: Mock;
	once: Mock;
	pipe: Mock;
}

describe( 'BackupHandlerFactory', () => {
	beforeEach( () => {
		vi.clearAllMocks();
		vi.mocked( path.join ).mockImplementation( ( ...args ) => args.join( '/' ) );
		vi.mocked( path.dirname ).mockImplementation( ( p ) => {
			const parts = p.split( '/' );
			parts.pop();
			return parts.join( '/' );
		} );
		vi.mocked( fse.ensureDir ).mockResolvedValue( undefined );
		vi.mocked( fs.promises.copyFile ).mockResolvedValue( undefined );
	} );

	describe( 'create', () => {
		it( 'should create a handler for gzip archives', () => {
			const archiveInfo: BackupArchiveInfo = {
				path: '/path/to/backup.tar.gz',
				type: 'application/gzip',
			};
			vi.mocked( path.extname ).mockReturnValue( '.gz' );
			const handler = BackupHandlerFactory.create( archiveInfo );
			expect( handler ).toBeInstanceOf( BackupHandlerTarGz );
		} );

		it( 'should create a handler for zip archives', () => {
			const archiveInfo: BackupArchiveInfo = {
				path: '/path/to/backup.zip',
				type: 'application/zip',
			};
			vi.mocked( path.extname ).mockReturnValue( '.zip' );
			const handler = BackupHandlerFactory.create( archiveInfo );
			expect( handler ).toBeInstanceOf( BackupHandlerZip );
		} );

		it( 'should create a handler for SQL files', () => {
			const archiveInfo: BackupArchiveInfo = {
				path: '/path/to/backup.sql',
				type: 'application/sql',
			};
			vi.mocked( path.extname ).mockReturnValue( '.sql' );
			const handler = BackupHandlerFactory.create( archiveInfo );
			expect( handler ).toBeInstanceOf( BackupHandlerSql );
		} );

		it( 'should return undefined handler for unsupported file types', () => {
			const archiveInfo: BackupArchiveInfo = {
				path: '/path/to/backup.unknown',
				type: 'application/unknown',
			};
			vi.mocked( path.extname ).mockReturnValue( '.unknown' );
			const handler = BackupHandlerFactory.create( archiveInfo );
			expect( handler ).toBeUndefined();
		} );
	} );

	describe( 'listFiles', () => {
		const archiveFiles = [
			'index.php',
			'.hidden-file',
			'wp-content/.hidden-file',
			'wp-content/.gitignore',
			'wp-content/plugins/hello.php',
			'wp-content/themes/twentytwentyfour/theme.json',
			'wp-content/uploads/2024/07/image.png',
			'wp-content/.DS_Store',
			'__MACOSX/meta-file',
		];
		const expectedArchiveFiles = [
			'index.php',
			'.hidden-file',
			'wp-content/.hidden-file',
			'wp-content/.gitignore',
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

			vi.spyOn( tar, 't' ).mockImplementation( ( { onReadEntry } ) => {
				archiveFiles.forEach( ( path ) => onReadEntry?.( { path } as tar.ReadEntry ) );
			} );

			await expect( handler?.listFiles( archiveInfo ) ).resolves.toEqual( expectedArchiveFiles );
		} );

		it( 'should list files from a zip archive', async () => {
			const archiveInfo: BackupArchiveInfo = {
				path: '/path/to/backup.zip',
				type: 'application/zip',
			};
			const handler = BackupHandlerFactory.create( archiveInfo );

			const mockZipFile: MockZipFile = {
				on: vi.fn().mockImplementation( ( event, callback ) => {
					if ( event === 'entry' ) {
						archiveFiles.forEach( ( file ) => callback( { fileName: file } ) );
					} else if ( event === 'end' ) {
						callback();
					}
					return mockZipFile;
				} ),
				readEntry: vi.fn(),
			};

			vi.mocked( yauzl.open, { partial: true } ).mockImplementation(
				(
					path: string,
					optionsOrCallback?:
						| yauzl.Options
						| ( ( err: Error | null, zipfile: yauzl.ZipFile ) => void ),
					callback?: ( err: Error | null, zipfile: yauzl.ZipFile ) => void
				) => {
					const cb = typeof optionsOrCallback === 'function' ? optionsOrCallback : callback;
					cb?.( null, createMock< yauzl.ZipFile >( mockZipFile ) );
				}
			);

			await expect( handler?.listFiles( archiveInfo ) ).resolves.toEqual( expectedArchiveFiles );
		} );

		it( 'should list a single SQL file', async () => {
			const archiveInfo: BackupArchiveInfo = {
				path: '/path/to/backup.sql',
				type: 'application/sql',
			};
			const handler = BackupHandlerFactory.create( archiveInfo );
			vi.mocked( path.basename ).mockReturnValue( 'backup.sql' );
			const result = await handler?.listFiles( archiveInfo );
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

			const createReadStreamMock: Partial< fs.ReadStream > = {
				on: vi.fn().mockImplementation( ( event, callback ) => {
					if ( event === 'finish' ) {
						callback();
					}
					return createReadStreamMock;
				} ),
				pipe: vi.fn().mockReturnThis(),
			} as Partial< fs.ReadStream >;
			vi.mocked( fs.createReadStream, { partial: true } ).mockReturnValue(
				createReadStreamMock as fs.ReadStream
			);
			vi.mocked( fs.statSync, { partial: true } ).mockReturnValueOnce(
				createMock< fs.Stats >( { size: 1000 } )
			);

			await expect(
				handler?.extractFiles( archiveInfo, extractionDirectory )
			).resolves.not.toThrow();
			expect( tar.x ).toHaveBeenCalledWith( {
				cwd: extractionDirectory,
				onReadEntry: expect.any( Function ),
				onwarn: expect.any( Function ),
			} );
		} );

		it( 'should extract files from a zip archive', async () => {
			const archiveInfo: BackupArchiveInfo = {
				path: '/path/to/backup.zip',
				type: 'application/zip',
			};
			const handler = BackupHandlerFactory.create( archiveInfo );
			const extractionDirectory = '/tmp/extracted';

			const mockReadStream: MockReadStream = {
				on: vi.fn().mockImplementation( ( event, callback ) => {
					if ( event === 'data' ) {
						callback( Buffer.from( 'test data' ) );
					}
					return mockReadStream;
				} ),
				once: vi.fn().mockReturnThis(),
				pipe: vi.fn().mockReturnThis(),
			};

			const mockWriteStream: Partial< fs.WriteStream > = {
				on: vi.fn().mockImplementation( ( event, callback ) => {
					if ( event === 'finish' ) {
						callback();
					}
					return mockWriteStream;
				} ),
				once: vi.fn().mockImplementation( ( event, callback ) => {
					if ( event === 'finish' ) {
						callback();
					}
					return mockWriteStream;
				} ),
			} as Partial< fs.WriteStream >;

			let entryCallback: ( ( entry: { fileName: string } ) => void ) | undefined;
			let endCallback: ( () => void ) | undefined;
			let emittedEntry = false;

			const mockZipFile: MockZipFile = {
				on: vi.fn().mockImplementation( ( event, callback ) => {
					if ( event === 'entry' ) {
						entryCallback = callback;
					} else if ( event === 'end' ) {
						endCallback = callback;
					}
					return mockZipFile;
				} ),
				readEntry: vi.fn().mockImplementation( () => {
					if ( ! emittedEntry && entryCallback ) {
						emittedEntry = true;
						entryCallback( { fileName: 'test.txt' } );
						return;
					}
					endCallback?.();
				} ),
				openReadStream: vi.fn().mockImplementation( ( entry, callback ) => {
					callback( null, mockReadStream );
				} ),
			};

			vi.mocked( yauzl.open, { partial: true } ).mockImplementation(
				(
					path: string,
					optionsOrCallback?:
						| yauzl.Options
						| ( ( err: Error | null, zipfile: yauzl.ZipFile ) => void ),
					callback?: ( err: Error | null, zipfile: yauzl.ZipFile ) => void
				) => {
					const cb = typeof optionsOrCallback === 'function' ? optionsOrCallback : callback;
					cb?.( null, createMock< yauzl.ZipFile >( mockZipFile ) );
				}
			);
			vi.mocked( fs.createWriteStream, { partial: true } ).mockReturnValue(
				mockWriteStream as fs.WriteStream
			);
			vi.mocked( fs.statSync, { partial: true } ).mockReturnValue(
				createMock< fs.Stats >( { size: 1000 } )
			);

			await expect(
				handler?.extractFiles( archiveInfo, extractionDirectory )
			).resolves.not.toThrow();

			// Wait for async callbacks to complete
			await new Promise( ( resolve ) => setTimeout( resolve, 10 ) );

			// Verify zip file was opened with correct options
			expect( yauzl.open ).toHaveBeenCalledWith(
				archiveInfo.path,
				{ lazyEntries: true },
				expect.any( Function )
			);

			// Verify readEntry was called to start reading entries
			expect( mockZipFile.readEntry ).toHaveBeenCalled();

			// Verify openReadStream was called for the entry
			expect( mockZipFile.openReadStream ).toHaveBeenCalledWith(
				{ fileName: 'test.txt' },
				expect.any( Function )
			);

			// Verify write stream was created with correct path
			expect( fs.createWriteStream ).toHaveBeenCalledWith(
				path.join( extractionDirectory, 'test.txt' )
			);

			// Verify pipe was called to connect read and write streams
			expect( mockReadStream.pipe ).toHaveBeenCalledWith( mockWriteStream );

			// Verify event handlers were set up
			expect( mockReadStream.once ).toHaveBeenCalledWith( 'error', expect.any( Function ) );
			expect( mockWriteStream.once ).toHaveBeenCalledWith( 'error', expect.any( Function ) );
			expect( mockReadStream.on ).toHaveBeenCalledWith( 'data', expect.any( Function ) );
			expect( mockWriteStream.once ).toHaveBeenCalledWith( 'finish', expect.any( Function ) );
		} );

		it( 'should copy SQL file to extraction directory', async () => {
			const archiveInfo: BackupArchiveInfo = {
				path: '/path/to/backup.sql',
				type: 'application/sql',
			};
			const handler = BackupHandlerFactory.create( archiveInfo );
			const extractionDirectory = '/tmp/extracted';
			vi.mocked( path.basename ).mockReturnValue( 'backup.sql' );
			vi.mocked( fs.promises.copyFile ).mockResolvedValue( undefined );

			await expect(
				handler?.extractFiles( archiveInfo, extractionDirectory )
			).resolves.not.toThrow();
			expect( fs.promises.copyFile ).toHaveBeenCalledWith(
				archiveInfo.path,
				path.join( extractionDirectory, 'backup.sql' )
			);
		} );
	} );
} );
