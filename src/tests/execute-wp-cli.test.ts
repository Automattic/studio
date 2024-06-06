/**
 * @jest-environment node
 */

import getWpNowConfig from '../../vendor/wp-now/src/config';
import { downloadWPCLI } from '../../vendor/wp-now/src/download';
import { executeWPCli } from '../../vendor/wp-now/src/execute-wp-cli';
import getWpCliPath from '../../vendor/wp-now/src/get-wp-cli-path';
import startWPNow from '../../vendor/wp-now/src/wp-now';

jest.mock( '../../vendor/wp-now/src/download' );
jest.mock( '../../vendor/wp-now/src/wp-now' );
jest.mock( '../../vendor/wp-now/src/get-wp-cli-path' );
jest.mock( '../../vendor/wp-now/src/config' );

const mockPhpInstance = {
	setSapiName: jest.fn().mockResolvedValue( undefined ),
	mkdir: jest.fn().mockResolvedValue( undefined ),
	writeFile: jest.fn().mockResolvedValue( undefined ),
	mount: jest.fn().mockResolvedValue( undefined ),
	run: jest.fn().mockResolvedValue( {
		text: 'admin user yoda',
		errors: 'serious error',
	} ),
	readFileAsText: jest.fn().mockResolvedValue( 'mocked stderr content' ),
};
( startWPNow as jest.Mock ).mockResolvedValue( {
	phpInstances: [ null, mockPhpInstance ],
	options: {},
} );
( getWpNowConfig as jest.Mock ).mockResolvedValue( {} );
( getWpCliPath as jest.Mock ).mockReturnValue( '/mock/wp-cli.phar' );

describe( 'executeWPCli', () => {
	it( 'should execute wp-cli command and return stdout and stderr', async () => {
		const args = [ 'user', 'list' ];

		const result = await executeWPCli( args );

		expect( result.stdout ).toBe( 'admin user yoda' );
		expect( result.stderr ).toBe( 'serious error' );
		expect( downloadWPCLI ).toHaveBeenCalled();
		expect( mockPhpInstance.setSapiName ).toHaveBeenCalledWith( 'cli' );
		expect( mockPhpInstance.mkdir ).toHaveBeenCalledWith( '/tmp' );
		expect( mockPhpInstance.writeFile ).toHaveBeenCalledTimes( 2 );
		expect( mockPhpInstance.mount ).toHaveBeenCalledWith( '/mock/wp-cli.phar', '/tmp/wp-cli.phar' );
		expect( mockPhpInstance.run ).toHaveBeenCalledWith( {
			scriptPath: '/tmp/run-cli.php',
		} );
	} );
} );
