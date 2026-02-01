import { createSiteTool } from './create-site';
import { executeWpCliTool } from './execute-wp-cli';
import { exploreFileTreeTool } from './explore-file-tree';
import { getSitesTool } from './get-sites';
import { getThemeDetailsTool } from './get-theme-details';
import { manageSiteTool } from './manage-site';
import { searchSupportDocsTool } from './search-support-docs';
import { updateSiteTool } from './update-site';
import { validateBlueprintTool } from './validate-blueprint';
import type { BaseTool } from './base-tool';

// All available tools
export const tools: BaseTool[] = [
	executeWpCliTool,
	createSiteTool,
	manageSiteTool,
	getSitesTool,
	exploreFileTreeTool,
	getThemeDetailsTool,
	validateBlueprintTool,
	updateSiteTool,
	searchSupportDocsTool,
];

// Export individual tools for direct access
export {
	createSiteTool,
	executeWpCliTool,
	exploreFileTreeTool,
	getSitesTool,
	getThemeDetailsTool,
	manageSiteTool,
	searchSupportDocsTool,
	updateSiteTool,
	validateBlueprintTool,
};

// Export base tool types
export { BaseTool, successResult, errorResult } from './base-tool';
