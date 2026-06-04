import type { SessionPreviewTab, SessionPreviewTabKind } from '@/hooks/use-session-ui';

type ExplorerAgentPanelKind = Exclude< SessionPreviewTabKind, 'empty' >;

interface ExplorerAgentContextOptions {
	prompt: string;
	visiblePanelKinds: readonly ExplorerAgentPanelKind[];
	browserPath?: string;
}

const TAB_CONTEXT: Record< ExplorerAgentPanelKind, string > = {
	wordpress: 'WordPress screen',
	'site-map': 'Site Map canvas',
	theme: 'Theme canvas',
};

export function getVisibleExplorerPanelKinds( {
	visibleTabIds,
	tabs,
}: {
	visibleTabIds: readonly string[];
	tabs: readonly SessionPreviewTab[];
} ): ExplorerAgentPanelKind[] {
	const tabKinds = new Map(
		tabs.map( ( tab ) => [ tab.id, ( tab.kind ?? 'wordpress' ) as SessionPreviewTabKind ] )
	);
	return visibleTabIds
		.map( ( tabId ) => {
			const kind = tabKinds.get( tabId );
			return kind === 'empty' ? undefined : kind;
		} )
		.filter( ( kind, index, kinds ): kind is ExplorerAgentPanelKind => {
			return Boolean( kind ) && kinds.indexOf( kind ) === index;
		} );
}

export function buildExplorerAgentPrompt( {
	prompt,
	visiblePanelKinds,
	browserPath,
}: ExplorerAgentContextOptions ) {
	const trimmedPrompt = prompt.trim();
	if ( trimmedPrompt.startsWith( '/' ) ) {
		return prompt;
	}

	const uniqueVisiblePanelKinds = visiblePanelKinds.filter(
		( panelKind, index, panelKinds ) => panelKinds.indexOf( panelKind ) === index
	);
	if ( uniqueVisiblePanelKinds.length === 0 ) {
		return prompt;
	}

	const visiblePanels = uniqueVisiblePanelKinds
		.map( ( panelKind ) => {
			if ( panelKind === 'wordpress' && browserPath ) {
				return `${ TAB_CONTEXT[ panelKind ] } (${ browserPath })`;
			}
			return TAB_CONTEXT[ panelKind ];
		} )
		.join( ', ' );
	const siteMapGuidance = uniqueVisiblePanelKinds.includes( 'site-map' )
		? '\n- If the request is about information architecture, navigation, pages, URLs, or content structure, use the visible Site Map canvas as primary context.'
		: '';
	const themeGuidance = uniqueVisiblePanelKinds.includes( 'theme' )
		? '\n- If the request is about design, colors, typography, templates, patterns, or theme structure, use the visible Theme canvas as primary context.'
		: '';

	return `Studio Explorer context:
- Visible panels: ${ visiblePanels }.${ siteMapGuidance }${ themeGuidance }

User request:
${ prompt }`;
}
