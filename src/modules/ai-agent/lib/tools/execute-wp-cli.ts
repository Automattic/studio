import * as ipcHandlers from 'src/ipc-handlers';
import { type BaseTool, successResult, errorResult } from './base-tool';
import type { ToolDefinition, ToolResult, WpCliValidationResult } from '../../types';
import type { IpcMainInvokeEvent } from 'electron';

// Blocked commands that are too destructive
const BLOCKED_COMMANDS = [ 'db drop', 'db reset', 'site empty', 'rm -rf', 'core download --force' ];

// Commands that require extra caution
const WARNING_PATTERNS = [ '--force', '--yes', 'delete', 'deactivate', 'uninstall' ];

/**
 * Validates a WP-CLI command for safety.
 */
export function validateWpCliCommand( command: string ): WpCliValidationResult {
	const normalizedCommand = command.toLowerCase().trim();

	// Check for blocked commands
	for ( const blocked of BLOCKED_COMMANDS ) {
		if ( normalizedCommand.includes( blocked ) ) {
			return {
				isAllowed: false,
				requiresConfirmation: false,
				blockedReason: `Command contains blocked operation: ${ blocked }`,
			};
		}
	}

	// Check for commands that might need warning
	let warningMessage: string | undefined;
	for ( const pattern of WARNING_PATTERNS ) {
		if ( normalizedCommand.includes( pattern ) ) {
			warningMessage = `Command contains potentially destructive flag: ${ pattern }`;
			break;
		}
	}

	return {
		isAllowed: true,
		requiresConfirmation: !! warningMessage,
		warningMessage,
	};
}

const definition: ToolDefinition = {
	name: 'execute_wp_cli',
	description: `Execute a WP-CLI command on the WordPress site. Use this to manage plugins, themes, users, posts, options, and other WordPress operations.

Common commands:
- plugin list, plugin install <slug>, plugin activate <slug>, plugin deactivate <slug>
- theme list, theme install <slug>, theme activate <slug>
- user list, user create <login> <email>
- option get <name>, option update <name> <value>
- post list, post create
- cache flush
- search-replace <old> <new>

IMPORTANT: Some commands are blocked for safety (db drop, db reset, site empty, rm -rf).
Commands with --force or deletion operations will show a warning.`,
	input_schema: {
		type: 'object' as const,
		properties: {
			command: {
				type: 'string',
				description:
					'The WP-CLI command to execute (without the "wp" prefix). For example: "plugin list --status=active"',
			},
		},
		required: [ 'command' ],
	},
};

async function execute( input: Record< string, unknown >, siteId: string ): Promise< ToolResult > {
	const command = input.command as string;

	if ( ! command || typeof command !== 'string' ) {
		return errorResult( 'Command is required and must be a string' );
	}

	// Validate command safety
	const validation = validateWpCliCommand( command );
	if ( ! validation.isAllowed ) {
		return errorResult( `Command blocked: ${ validation.blockedReason }` );
	}

	try {
		// Create a mock event for the IPC handler
		const mockEvent = {} as IpcMainInvokeEvent;

		const result = await ipcHandlers.executeWPCLiInline( mockEvent, {
			siteId,
			args: command,
			skipPluginsAndThemes: false,
		} );

		if ( result.exitCode !== 0 ) {
			const errorMessage = result.stderr || `Command failed with exit code ${ result.exitCode }`;
			return errorResult( errorMessage );
		}

		let output = result.stdout || 'Command executed successfully (no output)';

		// Add warning if applicable
		if ( validation.warningMessage ) {
			output = `[Warning: ${ validation.warningMessage }]\n\n${ output }`;
		}

		return successResult( output );
	} catch ( error ) {
		const errorMessage = error instanceof Error ? error.message : String( error );
		return errorResult( `Failed to execute WP-CLI command: ${ errorMessage }` );
	}
}

export const executeWpCliTool: BaseTool = {
	definition,
	execute,
};
