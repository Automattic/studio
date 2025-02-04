/**
 * @jest-environment node
 */
import { app } from 'electron';
import * as cli from '../cli';

jest.mock( '../../../vendor/wp-now/src/execute-wp-cli' );

describe( 'listenCLICommands', () => {
	beforeEach( () => {
		jest.clearAllMocks();
	} );

	it( 'should handle second-instance event with valid CLI command data', async () => {
		const mockExecuteCLICommand = jest.spyOn( cli, 'executeCLICommand' );

		cli.listenCLICommands();

		const secondInstanceCallback = ( app.on as jest.Mock ).mock.calls.find(
			( [ event ] ) => event === 'second-instance'
		)[ 1 ];

		await secondInstanceCallback( {}, [], '', { cliCommand: '--cli="wp plugin list"' } );

		expect( mockExecuteCLICommand ).toHaveBeenCalled();
	} );

	it( 'should not execute CLI command when additional data is invalid', async () => {
		const mockExecuteCLICommand = jest.spyOn( cli, 'executeCLICommand' );

		cli.listenCLICommands();

		const secondInstanceCallback = ( app.on as jest.Mock ).mock.calls.find(
			( [ event ] ) => event === 'second-instance'
		)[ 1 ];

		await secondInstanceCallback( {}, [], '', { invalidKey: 'some value' } );

		expect( mockExecuteCLICommand ).not.toHaveBeenCalled();
	} );
} );
