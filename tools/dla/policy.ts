/**
 * Permission policy for bridged Data Liberation Agent (DLA) tools.
 *
 * Two layers cooperate to keep destructive DLA actions safe:
 *
 * 1. An adapter-layer `shouldBlock` check that the per-tool `execute()`
 *    wrapper consults before forwarding a call to the MCP child. Returning
 *    `{ block: true }` causes the wrapper to throw, which pi surfaces to
 *    the model as a tool-call error.
 * 2. An optional pi-coding-agent `ExtensionFactory` (created via
 *    `createDlaPolicyFactory`) that subscribes to the runtime's
 *    `tool_call` event and applies the same rules at the runtime layer.
 *    Mounting the factory adds defence in depth: even tools registered
 *    through paths the adapter does not own (e.g. future direct DLA-MCP
 *    registrations) still hit the policy.
 *
 * Bucket assignments mirror the RSM-3139 spec verbatim (see
 * `issues/rsm-3143-dla-pi-research/prior-art/rsm-3139-spec.md` step 6 and
 * `wave-1-mcp-bridge-feasibility.md` §5). The destructive-only escape
 * hatch — `liberate_import` with `delegate: true` — returns a manifest
 * without writing to the live WordPress site, which is the Studio-driven
 * import contract.
 */
import type {
	ExtensionAPI,
	ExtensionFactory,
	ToolCallEventResult,
} from '@earendil-works/pi-coding-agent';

/**
 * Permission buckets supported by the bridge. The five buckets follow the
 * RSM-3139 taxonomy:
 *
 * - `read-only`: detection/inspection tools that never write outside DLA's
 *   own state files. Always allowed.
 * - `network-read`: tools that hit the network to probe or fingerprint but
 *   do not write user-visible files. Always allowed.
 * - `fs-write`: tools that write files to the extraction output directory
 *   (WXR, media, fixtures). Allowed by default; can be tightened by
 *   callers that want explicit confirmation per call.
 * - `destructive`: tools that mutate user-visible state outside DLA's
 *   sandbox (notably `liberate_import` against a live WP site). Blocked
 *   unless the call carries the `delegate: true` escape hatch.
 * - `delegate-only`: never invoke directly; the caller (Studio CLI) is
 *   expected to honour the returned manifest itself. Reserved for future
 *   use — no DLA tool sits here today.
 */
export type DlaPermissionBucket =
	| 'read-only'
	| 'network-read'
	| 'fs-write'
	| 'destructive'
	| 'delegate-only';

/**
 * Mapping from DLA tool name to permission bucket. Consumers can clone
 * this map and override entries when constructing custom buckets.
 */
export type DlaPolicyBuckets = Record< string, DlaPermissionBucket >;

/**
 * Default bucket assignments for the 13 tools exposed by DLA's
 * `src/mcp-server.ts` at the pinned SHA. Matches the RSM-3139 spec.
 */
export const defaultPolicyBuckets: DlaPolicyBuckets = {
	liberate_detect: 'network-read',
	liberate_discover: 'network-read',
	liberate_inspect: 'network-read',
	liberate_status: 'read-only',
	liberate_extract: 'fs-write',
	liberate_qa: 'fs-write',
	liberate_verify: 'read-only',
	liberate_setup: 'read-only',
	liberate_import: 'destructive',
	liberate_preview: 'fs-write',
	liberate_preview_stop: 'read-only',
	liberate_map_apis: 'network-read',
	liberate_probe: 'network-read',
};

/**
 * Decision returned by `shouldBlock`. When `block` is true, `reason` is
 * the human-readable explanation that surfaces to the model as the
 * tool-call error message.
 */
export interface DlaPolicyDecision {
	/** Whether to short-circuit the tool call as denied. */
	block: boolean;
	/** Reason for the block, surfaced to the model when `block` is true. */
	reason?: string;
}

/**
 * Decide whether a DLA tool invocation should be blocked, based on the
 * tool's bucket and any per-tool argument constraints.
 *
 * Defense-in-depth invariants implemented here:
 *
 * - Tools in the `destructive` bucket are blocked unless the caller opted
 *   into DLA's `delegate: true` mode, which guarantees the server
 *   returns a manifest and performs no writes.
 * - Tools absent from `buckets` default to a hard block — if DLA ships a
 *   new tool we have not reviewed, the bridge refuses to forward calls
 *   to it until the bucket table is updated.
 *
 * @param toolName - The bridged tool's MCP name (`liberate_*`).
 * @param input - The arguments the model emitted for the call.
 * @param buckets - The bucket map to consult. Defaults to
 *   `defaultPolicyBuckets`.
 * @returns A `DlaPolicyDecision` describing whether to block.
 *
 * @example
 * shouldBlock( 'liberate_import', { delegate: false } )
 * // -> { block: true, reason: '...' }
 */
export function shouldBlock(
	toolName: string,
	input: unknown,
	buckets: DlaPolicyBuckets = defaultPolicyBuckets
): DlaPolicyDecision {
	const bucket = buckets[ toolName ];
	if ( ! bucket ) {
		return {
			block: true,
			reason: `Studio refused to invoke unknown DLA tool "${ toolName }" — add it to the policy bucket table to allow it.`,
		};
	}

	if ( bucket === 'destructive' ) {
		const args = ( isRecord( input ) ? input : {} ) as Record< string, unknown >;
		if ( args.delegate !== true ) {
			return {
				block: true,
				reason: `Studio enforces "delegate: true" on the destructive DLA tool "${ toolName }". Re-invoke with delegate:true to receive a manifest, then use Studio's own tools to perform the action.`,
			};
		}
		return { block: false };
	}

	if ( bucket === 'delegate-only' ) {
		return {
			block: true,
			reason: `Studio does not invoke "${ toolName }" directly — handle the result of an upstream delegate call instead.`,
		};
	}

	return { block: false };
}

/**
 * Type guard for plain objects (excludes arrays and null).
 */
function isRecord( value: unknown ): value is Record< string, unknown > {
	return typeof value === 'object' && value !== null && ! Array.isArray( value );
}

/**
 * Build a pi-coding-agent `ExtensionFactory` that hooks the runtime's
 * `tool_call` event and enforces `shouldBlock` for any DLA-bridged tool.
 *
 * This is the policy extension factory used by T4 (the pi-runtime
 * wiring): the factory itself only consults the bucket map; the bridge's
 * adapter is responsible for wrapping `execute()` and throwing on the
 * adapter-layer check.
 *
 * @param buckets - Bucket map to consult. Defaults to
 *   `defaultPolicyBuckets`.
 * @returns An `ExtensionFactory` suitable for the runtime's
 *   `DefaultResourceLoader` `extensionFactories` slot.
 *
 * @example
 * const factory = createDlaPolicyFactory( defaultPolicyBuckets );
 * new DefaultResourceLoader( { extensionFactories: [ factory ] } );
 */
export function createDlaPolicyFactory(
	buckets: DlaPolicyBuckets = defaultPolicyBuckets
): ExtensionFactory {
	return ( pi: ExtensionAPI ): void => {
		pi.on( 'tool_call', ( event ): ToolCallEventResult | undefined => {
			// Only enforce policy on DLA-bridged tools; ignore everything
			// else so the factory is safe to mount alongside the rest of
			// the runtime's customTools.
			if ( ! ( event.toolName in buckets ) ) {
				return undefined;
			}
			const decision = shouldBlock( event.toolName, event.input, buckets );
			if ( decision.block ) {
				return { block: true, reason: decision.reason };
			}
			return undefined;
		} );
	};
}
