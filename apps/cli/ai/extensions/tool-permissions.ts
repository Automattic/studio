// In-process enforcement for gated tools. pi fires `tool_call` before a tool
// executes; returning `{ block: true, reason }` cancels the call and surfaces
// `reason` to the model as an error tool result. Because the check lives
// inside tool execution, the model has no path around it — prompt guidance is
// advisory, this is not.

import { randomUUID } from 'crypto';
import {
	isGatedToolName,
	supportsAlwaysAllow,
	type PermissionDecision,
	type PermissionRequestData,
} from '@studio/common/ai/tool-permissions';
import { grantAlwaysAllow, resolveToolPermission } from 'cli/ai/permissions/policy';
import { TOOL_PERMISSION_SPECS } from 'cli/ai/permissions/specs';
import type { ExtensionFactory } from '@earendil-works/pi-coding-agent';

// Blocks until the user decides. Implemented by each surface: the terminal UI
// renders a select list, the JSON adapter round-trips over IPC to the desktop.
// Absent in non-interactive contexts (eval runner, standalone --json, MCP),
// where gated tools fail closed instead of running.
export type PermissionRequestHandler = (
	request: PermissionRequestData
) => Promise< PermissionDecision >;

// Model-facing, intentionally not translated (same convention as tool errors).
function headlessBlockReason( toolName: string ): string {
	return (
		`${ toolName } requires interactive user confirmation, which is not available in this ` +
		`environment. Do not retry. Tell the user what you wanted to do and why it needs their approval.`
	);
}

function deniedBlockReason( toolName: string ): string {
	return (
		`The user declined permission to run ${ toolName }. Do not retry or work around this. ` +
		`Acknowledge the decision and ask what they would like to do instead.`
	);
}

export function createToolPermissionsExtension( options: {
	onRequestPermission?: PermissionRequestHandler;
} ): ExtensionFactory {
	return ( pi ) => {
		pi.on( 'tool_call', async ( event ) => {
			const level = await resolveToolPermission( event.toolName, event.input );
			if ( level === 'allow' ) {
				return;
			}

			if ( ! options.onRequestPermission ) {
				return { block: true, reason: headlessBlockReason( event.toolName ) };
			}

			// isGatedToolName is guaranteed here (resolveToolPermission only
			// returns `ask` for gated tools); the guard narrows the type.
			if ( ! isGatedToolName( event.toolName ) ) {
				return;
			}
			const spec = TOOL_PERMISSION_SPECS[ event.toolName ];
			const description = await spec.describe( event.input );
			const request: PermissionRequestData = {
				id: randomUUID(),
				toolCallId: event.toolCallId,
				toolName: event.toolName,
				title: description.title,
				consequences: description.consequences,
				actionLabel: spec.actionLabel(),
				allowedLabel: spec.allowedLabel(),
				deniedLabel: spec.deniedLabel(),
				params: event.input,
				allowAlways: supportsAlwaysAllow( event.toolName ),
			};

			const decision = await options.onRequestPermission( request );

			if ( decision === 'always_allow' ) {
				// For tools that never support it (site_delete) a stray
				// `always_allow` degrades to allow-once inside grantAlwaysAllow.
				await grantAlwaysAllow( event.toolName );
				return;
			}
			if ( decision === 'allow_once' ) {
				return;
			}
			return { block: true, reason: deniedBlockReason( event.toolName ) };
		} );
	};
}
