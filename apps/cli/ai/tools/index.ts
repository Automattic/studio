/**
 * Per-file tool registrations live in this directory; each tool exports a
 * single `tool(...)` definition. Aggregated here so the legacy
 * `apps/cli/ai/tools.ts` can include them in the MCP server registration.
 *
 * Add new tools by exporting from a new file and re-exporting them in the
 * `previewSteeringPerFileToolDefinitions` array below.
 */
import { generatePanelTool } from './generate-panel';
import { showPanelTool } from './show-panel';

export { showPanelTool, composePanelUrl } from './show-panel';
export { generatePanelTool, validateScratchSource } from './generate-panel';
export type { PanelIntent, ComposedPanelUrl } from './show-panel';

/**
 * Tools that ride along with the preview-steering set — they only make sense
 * when a Studio desktop UI is on the other end of the agent event stream
 * (because they emit `preview.command` events).
 */
export const previewSteeringPerFileToolDefinitions = [ showPanelTool, generatePanelTool ];
