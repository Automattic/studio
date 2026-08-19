import { useState } from 'react';
import { SiteOverviewView } from '@/components/site-overview-view';
import { SessionView } from '@/ui-classic/components/session-view';
import styles from './style.module.css';
import type { SiteSettingsTabId } from '@/components/site-settings-view';

interface SiteWorkspaceProps {
	siteId: string;
	activeView: 'chat' | 'overview';
	sessionId?: string;
	overviewTab: SiteSettingsTabId;
	openSiteDropdown?: boolean;
	onOverviewTabChange: ( tab: SiteSettingsTabId ) => void;
}

export function SiteWorkspace( {
	siteId,
	activeView,
	sessionId,
	overviewTab,
	openSiteDropdown = false,
	onOverviewTabChange,
}: SiteWorkspaceProps ) {
	const [ retainedSessionId, setRetainedSessionId ] = useState( sessionId );
	const [ hasVisitedOverview, setHasVisitedOverview ] = useState( activeView === 'overview' );
	const [ retainedOverviewTab, setRetainedOverviewTab ] = useState( overviewTab );

	if ( sessionId && sessionId !== retainedSessionId ) {
		setRetainedSessionId( sessionId );
	}
	if ( activeView === 'overview' && ! hasVisitedOverview ) {
		setHasVisitedOverview( true );
	}
	if ( activeView === 'overview' && overviewTab !== retainedOverviewTab ) {
		setRetainedOverviewTab( overviewTab );
	}

	const chatActive = activeView === 'chat';
	const overviewActive = activeView === 'overview';
	const renderedSessionId = sessionId ?? retainedSessionId;
	const renderedOverviewTab = overviewActive ? overviewTab : retainedOverviewTab;

	return (
		<div className={ styles.root }>
			{ renderedSessionId ? (
				<div
					className={ `${ styles.layer } ${ chatActive ? styles.layerActive : '' }` }
					inert={ ! chatActive }
					aria-hidden={ ! chatActive || undefined }
				>
					<SessionView key={ renderedSessionId } sessionId={ renderedSessionId } />
				</div>
			) : null }
			{ overviewActive || hasVisitedOverview ? (
				<div
					className={ `${ styles.layer } ${ overviewActive ? styles.layerActive : '' }` }
					inert={ ! overviewActive }
					aria-hidden={ ! overviewActive || undefined }
				>
					<SiteOverviewView
						siteId={ siteId }
						activeTab={ renderedOverviewTab }
						openSiteDropdown={ overviewActive && openSiteDropdown }
						onTabChange={ onOverviewTabChange }
					/>
				</div>
			) : null }
		</div>
	);
}
