// Shared vocabulary for the agent tool-permission layer. The CLI enforces
// permissions in-process (apps/cli/ai/extensions/tool-permissions.ts); the
// desktop renderers and settings screens only consume these types and the
// gated-tool table, so the set of gated tools stays defined in one place.

// What the user can answer when a gated tool asks for permission. `deny` is a
// per-request decision, never a stored policy — see `ToolPermissionLevel`.
export type PermissionDecision = 'allow_once' | 'always_allow' | 'deny';

// Stored policy for a gated tool. `ask` (the default) prompts on every call;
// `allow` runs without prompting. There is intentionally no stored `deny`.
export type ToolPermissionLevel = 'allow' | 'ask';

// A single permission request, as emitted over the wire (`permission.requested`
// JSON event) and persisted in session transcripts (`studio.permission_request`).
export interface PermissionRequestData {
	// Unique per request; responses and transcript entries pair on this.
	id: string;
	toolCallId: string;
	toolName: string;
	// Pre-localized, human-readable action summary, e.g. `Delete site "Sunset Bakery"?`
	title: string;
	// Pre-localized consequence lines, most severe first.
	consequences: string[];
	// Pre-localized short noun phrase for the action, used to compose the
	// "Always allow …" choice (e.g. "pushing sites to WordPress.com").
	actionLabel: string;
	// Pre-localized labels for the resolved card, rendered as a compact
	// tool-call-style row once the user has decided (e.g. "Site deletion
	// denied"). Optional because transcripts written before these fields
	// existed still replay; renderers fall back to generic copy.
	allowedLabel?: string;
	deniedLabel?: string;
	// Raw tool arguments, for an expandable detail view.
	params: Record< string, unknown >;
	// Whether the UI may offer "Always allow". False for site_delete, which
	// must confirm every time regardless of stored preferences.
	allowAlways: boolean;
}

// The gated tools and whether each one may be relaxed to `allow` via
// "Always allow" / settings. Tools not listed here never prompt (v1) and are
// not configurable. `wp_cli` only prompts for destructive commands — see the
// classifier in apps/cli/ai/permissions/wp-cli-classifier.ts.
export const GATED_TOOLS = {
	site_delete: { supportsAlwaysAllow: false },
	preview_delete: { supportsAlwaysAllow: true },
	site_push: { supportsAlwaysAllow: true },
	site_pull: { supportsAlwaysAllow: true },
	site_import: { supportsAlwaysAllow: true },
	wp_cli: { supportsAlwaysAllow: true },
} as const satisfies Record< string, { supportsAlwaysAllow: boolean } >;

export type GatedToolName = keyof typeof GATED_TOOLS;

export const GATED_TOOL_NAMES = Object.keys( GATED_TOOLS ) as GatedToolName[];

export function isGatedToolName( toolName: string ): toolName is GatedToolName {
	return toolName in GATED_TOOLS;
}

// User-stored overrides, persisted in shared.json under `toolPermissions`.
// Only `allow` is ever stored (an `ask` entry is equivalent to deleting the
// override); site_delete entries are ignored by the resolver.
export type ToolPermissionOverrides = Partial< Record< GatedToolName, ToolPermissionLevel > >;

export function supportsAlwaysAllow( toolName: string ): boolean {
	return isGatedToolName( toolName ) && GATED_TOOLS[ toolName ].supportsAlwaysAllow;
}
