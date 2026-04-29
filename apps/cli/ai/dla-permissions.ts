import { __ } from '@wordpress/i18n';
import type { CanUseTool } from '@anthropic-ai/claude-agent-sdk';
import type { AskUserHandler, AskUserQuestion } from 'cli/ai/agent';

/**
 * Tool-name prefix that identifies the Data Liberation Agent's MCP tools.
 * Tools surface to the SDK as `mcp__<server-name>__<tool-name>` where
 * `<server-name>` is the key registered on `mcpServers` in `agent.ts`.
 */
export const DLA_TOOL_PREFIX = 'mcp__data-liberation__';

/**
 * Read-only DLA tools that are safe to auto-approve. None of these write to
 * disk, mutate the user's WordPress installation, or hit a remote write API.
 *
 * Names are stored without the `mcp__data-liberation__` prefix; the policy
 * resolver strips the prefix before lookup.
 */
const READ_ONLY_DLA_TOOLS = new Set( [
	'liberate_detect',
	'liberate_discover',
	'liberate_inspect',
	'liberate_status',
	'liberate_verify',
] );

/**
 * DLA tools that modify state but only locally — they write to disk, scrape
 * remote content into a manifest, or drive a Chromium devtools session. We
 * ask the user once per agent session and remember the answer for the rest
 * of the turn.
 */
const ASK_ONCE_DLA_TOOLS = new Set( [
	'liberate_extract',
	'liberate_setup',
	'liberate_map_apis',
	'liberate_probe',
] );

/**
 * Special-case tool that performs a remote import. Auto-approved when the
 * model passes `delegate: true` (DLA returns a manifest and Studio drives
 * the import via `wp_cli`); otherwise we fall through to ask-once behaviour.
 */
const IMPORT_DLA_TOOL = 'liberate_import';

/**
 * Strip the MCP server prefix from a fully-qualified tool name.
 *
 * @param toolName Fully-qualified tool name (e.g. `mcp__data-liberation__liberate_inspect`).
 * @returns The bare tool name (e.g. `liberate_inspect`), or `null` if the tool is not a DLA tool.
 *
 * @example
 * stripDlaPrefix( 'mcp__data-liberation__liberate_inspect' ); // 'liberate_inspect'
 * stripDlaPrefix( 'Read' ); // null
 */
function stripDlaPrefix( toolName: string ): string | null {
	if ( ! toolName.startsWith( DLA_TOOL_PREFIX ) ) {
		return null;
	}
	return toolName.slice( DLA_TOOL_PREFIX.length );
}

/**
 * Build the `AskUserQuestion` payload used to confirm a DLA tool invocation.
 *
 * @param dlaToolName The bare DLA tool name (without the `mcp__data-liberation__` prefix).
 * @returns An `AskUserQuestion` with allow/deny labels and a per-tool description.
 */
function buildConfirmationQuestion( dlaToolName: string ): AskUserQuestion {
	return {
		question: __( 'Allow Data Liberation Agent to run "%s"?' ).replace( '%s', dlaToolName ),
		options: [
			{
				label: __( 'Allow' ),
				description: __( 'Run this tool now and remember for this session.' ),
			},
			{
				label: __( 'Deny' ),
				description: __( 'Block this call. The agent can ask again later.' ),
			},
		],
	};
}

/**
 * Inspect a tool input record to determine whether the model passed
 * `delegate: true`. The flag short-circuits the import-confirmation prompt
 * because `delegate: true` means DLA returns a manifest rather than writing
 * to a remote site — Studio handles the actual import via `wp_cli`.
 *
 * @param input Raw `tool_input` object as supplied by the SDK.
 * @returns `true` only when the input has a literal boolean `delegate: true` key.
 */
function isDelegateTrue( input: Record< string, unknown > ): boolean {
	return input.delegate === true;
}

export interface BuildDlaCanUseToolOptions {
	/**
	 * Reuse the agent's `AskUserQuestion` plumbing for confirmation prompts.
	 * When omitted, ask-once tools default to deny with a clear message so
	 * we never silently allow a write operation in headless contexts.
	 */
	onAskUser?: AskUserHandler;
}

/**
 * Build the `canUseTool` callback that scopes per-tool permissions for the
 * Data Liberation Agent's MCP tools. Without this callback, the SDK's
 * `permissionMode: 'auto'` would auto-approve write-to-disk and remote-write
 * tools alongside genuinely read-only ones.
 *
 * Policy summary:
 * - Read-only DLA tools (`liberate_detect`, `_discover`, `_inspect`,
 *   `_status`, `_verify`) are auto-approved.
 * - `liberate_import` is auto-approved when the call carries `delegate: true`
 *   in `tool_input`; otherwise it falls through to the ask-once branch.
 * - Other state-changing DLA tools (`liberate_extract`, `_setup`,
 *   `_map_apis`, `_probe`) ask the user once per session via `onAskUser`.
 *   The answer is memoised in a closure-scoped Set keyed by tool name and
 *   reused for the rest of the agent turn.
 * - All non-DLA tools are passed through with `behavior: 'allow'` and the
 *   original `updatedInput`, leaving them to the SDK's auto classifier.
 *
 * @param options Configuration object.
 * @param options.onAskUser Handler used to render the confirmation prompt.
 * @returns A `CanUseTool` callback ready to register on `query()` options.
 *
 * @example
 * const canUseTool = buildDlaCanUseTool( { onAskUser } );
 * query( { prompt, options: { canUseTool, ... } } );
 */
export function buildDlaCanUseTool( options: BuildDlaCanUseToolOptions = {} ): CanUseTool {
	const { onAskUser } = options;

	// Memoise per-tool answers for the lifetime of this callback (and
	// therefore for a single `startAiAgent` invocation). The set holds the
	// bare DLA tool name once the user has approved that tool for the
	// session; subsequent calls skip the prompt entirely.
	const sessionAllowedTools = new Set< string >();

	return async ( toolName, input ) => {
		const dlaToolName = stripDlaPrefix( toolName );

		// Non-DLA tools fall through to the SDK's auto classifier. We must
		// still return an explicit allow shape because installing
		// `canUseTool` overrides the default classifier path.
		if ( dlaToolName === null ) {
			return { behavior: 'allow', updatedInput: input };
		}

		if ( READ_ONLY_DLA_TOOLS.has( dlaToolName ) ) {
			return { behavior: 'allow', updatedInput: input };
		}

		if ( dlaToolName === IMPORT_DLA_TOOL && isDelegateTrue( input ) ) {
			return { behavior: 'allow', updatedInput: input };
		}

		const requiresAskOnce =
			ASK_ONCE_DLA_TOOLS.has( dlaToolName ) || dlaToolName === IMPORT_DLA_TOOL;

		if ( ! requiresAskOnce ) {
			// Unknown DLA tool — deny by default rather than silently allowing
			// a write operation we have not classified. New DLA tool names
			// must be added to one of the policy sets above.
			return {
				behavior: 'deny',
				message: __(
					'Unrecognised Data Liberation Agent tool blocked by Studio policy. Add it to the per-tool allow list in apps/cli/ai/dla-permissions.ts.'
				),
			};
		}

		if ( sessionAllowedTools.has( dlaToolName ) ) {
			return { behavior: 'allow', updatedInput: input };
		}

		if ( ! onAskUser ) {
			// No interactive surface available (e.g. headless or scripted
			// runs). Deny rather than auto-approve to avoid silent writes.
			// TODO(RSM-1675 OQ2): wire a non-interactive override
			// (CLI flag / env var) so automated callers can opt in.
			return {
				behavior: 'deny',
				message: __(
					'Data Liberation Agent tool requires user confirmation, but no interactive prompt is available. Re-run `studio code` interactively or pass `delegate: true` for liberate_import.'
				),
			};
		}

		const question = buildConfirmationQuestion( dlaToolName );
		const answers = await onAskUser( [ question ] );
		const answer = answers[ question.question ];

		if ( answer === question.options[ 0 ].label ) {
			sessionAllowedTools.add( dlaToolName );
			return { behavior: 'allow', updatedInput: input };
		}

		return {
			behavior: 'deny',
			message: __( 'User declined to run this Data Liberation Agent tool.' ),
		};
	};
}
