/**
 * Public entry point for the `@studio/dla` workspace package.
 *
 * The package wraps Data Liberation Agent's stdio MCP server as a set
 * of pi-coding-agent `ToolDefinition`s suitable for the Studio CLI's
 * `customTools` slot, alongside a policy `ExtensionFactory` that the
 * pi runtime can mount via `DefaultResourceLoader.extensionFactories`.
 *
 * Three public surfaces:
 *
 * - {@link startDlaBridge}: spawn DLA's MCP server, list tools, return a
 *   bridge handle whose `tools` are pi-ready and whose `dispose()` tears
 *   down the child.
 * - {@link createDlaPolicyFactory}: build the pi extension factory that
 *   enforces per-tool permission buckets at the runtime layer.
 * - {@link defaultPolicyBuckets}: the canonical bucket assignments for
 *   DLA's 13 tools, mirroring the RSM-3139 spec.
 *
 * Implementation details — `bridge.ts`, `agent-tool-adapter.ts`,
 * `content-adapter.ts`, `policy.ts` — are private to the package.
 */

export {
	startDlaBridge,
	defaultTransportProvider,
	type DlaBridge,
	type StartDlaBridgeOptions,
	type BridgeTransportProvider,
} from './bridge';

export {
	adaptMcpToolToPi,
	DlaPolicyError,
	type RemoteMcpTool,
	type AdaptMcpToolOptions,
} from './agent-tool-adapter';

export {
	adaptMcpContent,
	adaptMcpContentBlock,
	type McpContentBlock,
	type McpTextBlock,
	type McpImageBlock,
	type McpAudioBlock,
	type McpResourceBlock,
	type McpResourceLinkBlock,
} from './content-adapter';

export {
	createDlaPolicyFactory,
	defaultPolicyBuckets,
	shouldBlock,
	type DlaPermissionBucket,
	type DlaPolicyBuckets,
	type DlaPolicyDecision,
} from './policy';
