// Resolves whether a tool call may run without confirmation. Precedence:
// session grant ("Always allow" earlier in this process) → stored user
// preference (shared.json `toolPermissions`) → built-in default (`ask` for
// every gated tool). `site_delete` ignores grants and preferences entirely —
// it always asks (see docs/design-docs/agent-tool-permissions.md, Decisions).

import {
	isGatedToolName,
	supportsAlwaysAllow,
	type GatedToolName,
	type ToolPermissionLevel,
} from '@studio/common/ai/tool-permissions';
import {
	lockSharedConfig,
	readSharedConfig,
	saveSharedConfig,
	unlockSharedConfig,
} from '@studio/common/lib/shared-config';
import { TOOL_PERMISSION_SPECS } from './specs';

// "Always allow" grants for the lifetime of this CLI process. The desktop
// forks a fresh process per turn, so cross-turn persistence there comes from
// shared.json — this set just avoids re-reading config within a turn.
const sessionGrants = new Set< GatedToolName >();

export async function resolveToolPermission(
	toolName: string,
	params: Record< string, unknown >
): Promise< ToolPermissionLevel > {
	if ( ! isGatedToolName( toolName ) ) {
		return 'allow';
	}

	const spec = TOOL_PERMISSION_SPECS[ toolName ];
	if ( spec.classify && spec.classify( params ) === 'allow' ) {
		return 'allow';
	}

	if ( ! supportsAlwaysAllow( toolName ) ) {
		return 'ask';
	}

	if ( sessionGrants.has( toolName ) ) {
		return 'allow';
	}

	try {
		const config = await readSharedConfig();
		if ( config.toolPermissions?.[ toolName ] === 'allow' ) {
			return 'allow';
		}
	} catch {
		// An unreadable config must never relax a permission — fall through to ask.
	}

	return 'ask';
}

// Used by /permissions when the user flips a tool back to "ask": an earlier
// in-process "Always allow" grant must not keep overriding the new setting.
export function clearSessionGrant( toolName: GatedToolName ): void {
	sessionGrants.delete( toolName );
}

export async function grantAlwaysAllow( toolName: GatedToolName ): Promise< void > {
	if ( ! supportsAlwaysAllow( toolName ) ) {
		return;
	}
	sessionGrants.add( toolName );
	await lockSharedConfig();
	try {
		const config = await readSharedConfig();
		await saveSharedConfig( {
			...config,
			toolPermissions: { ...config.toolPermissions, [ toolName ]: 'allow' },
		} );
	} finally {
		await unlockSharedConfig();
	}
}
