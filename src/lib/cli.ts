import { app } from 'electron';
import { executeWPCli } from '../../vendor/wp-now/src/execute-wp-cli';
import { withMainWindow } from '../main-window';

type CommandAction = 'wp';
interface Command {
	action: CommandAction;
	args: string[];
	executed: boolean;
}

const STANDALONE_COMMANDS: [ CommandAction ] = [ 'wp' ];
const systemLog = console.log;
let cliCommand: Command;

export const isCLI = () => app.commandLine.hasSwitch( 'cli' );

export const getCLIDataForMainInstance = () => {
	if ( ! isCLI() ) {
		return {};
	}

	return { cliCommand: app.commandLine.getSwitchValue( 'cli' ) };
};

export const listenCLICommands = () => {
	app.on( 'second-instance', async ( event, commandLine, workingDirectory, additionalData ) => {
		withMainWindow( async ( mainWindow ) => {
			const data = additionalData as { cliCommand: string };
			setCommand( data.cliCommand );
			const commandExecuted = await executeCLICommand();
			if ( commandExecuted ) {
				mainWindow.webContents.reload();
			}
		} );
	} );
};

export const processCLICommand = async ( {
	mainInstance,
	appBoot,
}: {
	mainInstance: boolean;
	appBoot?: () => Promise< void >;
} ) => {
	setCommand( app.commandLine.getSwitchValue( 'cli' ) );

	if ( STANDALONE_COMMANDS.includes( cliCommand.action ) ) {
		await executeCLICommand();
		app.quit();
	} else if ( mainInstance && appBoot ) {
		await appBoot();
	} else {
		app.quit();
	}
};

export const executeCLICommand = async () => {
	if ( cliCommand.executed ) {
		return false;
	}
	cliCommand.executed = true;

	await commands[ cliCommand.action ]?.();
	return true;
};

const commands = {
	wp: async () => {
		const { args } = cliCommand;
		const projectPath =
			args.find( ( arg ) => arg.startsWith( '--path=' ) )?.split( '=' )[ 1 ] || process.cwd();
		const argsSansPath = args.filter( ( arg ) => ! arg.startsWith( '--path=' ) );

		try {
			await executeWPCli( projectPath, argsSansPath );
		} catch ( _error ) {
			// `executeWPCli` will log the error for the user.
		}
	},
};

const setCommand = ( command: string ) => {
	const [ action, ...rest ] = command.split( ' ' );
	cliCommand = { action: action as CommandAction, args: rest, executed: false };
};

const disableConsole = () => {
	console.log = () => {
		// NOOP
	};
};
