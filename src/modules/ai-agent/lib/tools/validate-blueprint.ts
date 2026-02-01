import * as ipcHandlers from 'src/ipc-handlers';
import { type BaseTool, successResult, errorResult } from './base-tool';
import type { ToolDefinition, ToolResult } from '../../types';
import type { IpcMainInvokeEvent } from 'electron';

const definition: ToolDefinition = {
	name: 'validate_blueprint',
	description: `Validate a WordPress Playground Blueprint JSON configuration.

Blueprints are JSON configurations that define how to set up a WordPress site, including:
- WordPress version
- PHP version
- Plugins and themes to install
- Site settings
- Custom steps to run

This tool validates the blueprint structure and reports any errors.`,
	input_schema: {
		type: 'object' as const,
		properties: {
			blueprint: {
				type: 'object',
				description:
					'The Blueprint JSON object to validate. Should follow the WordPress Playground Blueprint schema.',
			},
		},
		required: [ 'blueprint' ],
	},
};

async function execute( input: Record< string, unknown >, _siteId: string ): Promise< ToolResult > {
	const blueprint = input.blueprint;

	if ( ! blueprint || typeof blueprint !== 'object' ) {
		return errorResult( 'Blueprint is required and must be a JSON object' );
	}

	try {
		const mockEvent = {} as IpcMainInvokeEvent;
		const validationResult = await ipcHandlers.validateBlueprint(
			mockEvent,
			blueprint as Record< string, unknown >
		);

		if ( validationResult.valid ) {
			const warnings = validationResult.warnings || [];
			if ( warnings.length > 0 ) {
				const warningMessages = warnings.map(
					( w: { feature: string; reason: string } ) => `- ${ w.feature }: ${ w.reason }`
				);
				return successResult(
					`Blueprint is valid with warnings:\n${ warningMessages.join( '\n' ) }`
				);
			}
			return successResult( 'Blueprint is valid!' );
		}

		return errorResult( `Blueprint validation failed: ${ validationResult.error }` );
	} catch ( error ) {
		const errorMessage = error instanceof Error ? error.message : String( error );
		return errorResult( `Failed to validate blueprint: ${ errorMessage }` );
	}
}

export const validateBlueprintTool: BaseTool = {
	definition,
	execute,
};
