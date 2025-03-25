import fs from 'fs';
import os from 'os';
import path from 'path';
import { Command } from 'commander';
import nock from 'nock';
import { registerCommand } from 'cli/commands/preview/create';
import { Logger } from 'cli/logger';

jest.mock( 'fs' );
jest.mock( 'cli/logger' );

describe( 'Preview Create Command', () => {
	const mockFolder = '/test/folder';
	const mockArchivePath = path.join( os.tmpdir(), `${ mockFolder }.zip` );
	let program: Command;
	let mockLogger: Logger< string >;

	beforeEach( () => {
		jest.clearAllMocks();
		nock.cleanAll();

		program = new Command();
		mockLogger = {
			reportProgress: jest.fn(),
			reportError: jest.fn(),
		} as unknown as Logger< string >;

		( Logger as jest.Mock ).mockImplementation( () => mockLogger );
		( fs.unlinkSync as jest.Mock ).mockImplementation( () => {} );

		nock( 'https://public-api.wordpress.com' )
			.post( '/rest/v1.1/jurassic-ninja/create-new-site-from-zip' )
			.reply( 200, { success: true } );
	} );

	it( 'should complete the preview creation process successfully', async () => {
		const mockWriteStream = {
			on: jest.fn( ( event, callback ) => {
				if ( event === 'close' ) {
					callback();
				}
			} ),
		};
		( fs.createWriteStream as jest.Mock ).mockReturnValue( mockWriteStream );

		registerCommand( program );
		await program.parseAsync( [ 'node', 'test', 'go', mockFolder ] );

		expect( fs.createWriteStream ).toHaveBeenCalledWith( mockArchivePath );
		expect( fs.unlinkSync ).toHaveBeenCalledWith( mockArchivePath );
	} );

	it( 'should use current directory when no folder is specified', async () => {
		const mockWriteStream = {
			on: jest.fn( ( event, callback ) => {
				if ( event === 'close' ) {
					callback();
				}
			} ),
		};
		( fs.createWriteStream as jest.Mock ).mockReturnValue( mockWriteStream );

		registerCommand( program );
		await program.parseAsync( [ 'node', 'test', 'go' ] );

		const currentDirArchivePath = path.join( os.tmpdir(), `${ process.cwd() }.zip` );
		expect( fs.createWriteStream ).toHaveBeenCalledWith( currentDirArchivePath );
		expect( fs.unlinkSync ).toHaveBeenCalledWith( currentDirArchivePath );
	} );

	it( 'should handle errors gracefully', async () => {
		const mockError = new Error( 'Test error' );
		( fs.createWriteStream as jest.Mock ).mockImplementation( () => {
			throw mockError;
		} );

		registerCommand( program );
		await program.parseAsync( [ 'node', 'test', 'go', mockFolder ] );

		expect( mockLogger.reportError ).toHaveBeenCalledWith( mockError.message );
	} );
} );
