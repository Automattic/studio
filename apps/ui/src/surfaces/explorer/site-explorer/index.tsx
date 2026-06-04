import { SitePreview } from '@/components/site-preview';
import { WordPressDataProvider } from '@/data/wordpress/provider';
import { type SessionPreviewUI } from '@/hooks/use-session-ui';
import { SiteCanvasExplorerPanel } from '@/surfaces/canvas/site-canvas-view';
import type { Annotation } from '@/components/site-preview/types';
import type { SiteDetails } from '@/data/core';

interface SiteExplorerProps {
	site: SiteDetails;
	preview: SessionPreviewUI;
	onAnnotationsDone: ( annotations: Annotation[] ) => void;
	collapsed: boolean;
	layoutWidth: number;
}

export function SiteExplorer( {
	site,
	preview,
	onAnnotationsDone,
	collapsed,
	layoutWidth,
}: SiteExplorerProps ) {
	return (
		<SitePreview
			site={ site }
			path={ preview.path }
			reloadNonce={ preview.reloadNonce }
			onAnnotationsDone={ onAnnotationsDone }
			collapsed={ collapsed }
			hideResizeHandle
			layoutWidth={ layoutWidth }
			tabs={ preview.tabs }
			activeTabId={ preview.activeTabId }
			onNewTab={ () => preview.openTab( { kind: 'empty' } ) }
			onSetTabContent={ preview.setTabContent }
			onCloseTab={ preview.closeTab }
			onSelectTab={ preview.selectTab }
			onNavigatePath={ preview.navigate }
			onActiveTabPathChange={ preview.updateActiveTabPath }
			renderCanvasTab={ ( tab ) =>
				tab.kind === 'site-map' || tab.kind === 'theme' ? (
					<WordPressDataProvider key={ site.id } siteId={ site.id }>
						<SiteCanvasExplorerPanel site={ site } view={ tab.kind } />
					</WordPressDataProvider>
				) : null
			}
		/>
	);
}
