import { studioToolDefinitions } from '@studio/agent/shared/tools';
import { scaffoldThemeTool } from '@studio/agent/shared/tools/scaffold-theme';
import { convertToBlocksTool } from './convert-to-blocks';
import type { StudioToolDefinition } from '@studio/agent/shared/tools/define-tool';

// The shared tools and those that read a site's files and block editor where
// only Node can, in the order the model sees them.
export const nodeStudioToolDefinitions: StudioToolDefinition[] = studioToolDefinitions.flatMap(
	( definition ) =>
		definition === scaffoldThemeTool ? [ definition, convertToBlocksTool ] : [ definition ]
);
