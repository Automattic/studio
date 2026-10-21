import { useState } from 'react';
import { SessionView, SignedOutSessionView } from '@/components/session-view';
import { SiteSettingsPage } from '@/components/site-settings-page';
import styles from './style.module.css';
import type { SiteSettingsTabId } from '@/components/site-settings-view';

interface SiteWorkspaceProps {
	siteId: string;
	activeView: 'chat' | 'settings';
	sessionId?: string;
	settingsTab: SiteSettingsTabId;
	onSettingsTabChange: ( tab: SiteSettingsTabId ) => void;
}

export function SiteWorkspace( {
	siteId,
	activeView,
	sessionId,
	settingsTab,
	onSettingsTabChange,
}: SiteWorkspaceProps ) {
	const [ retainedSessionId, setRetainedSessionId ] = useState( sessionId );
	const [ hasVisitedSettings, setHasVisitedSettings ] = useState( activeView === 'settings' );
	const [ retainedSettingsTab, setRetainedSettingsTab ] = useState( settingsTab );

	if ( sessionId && sessionId !== retainedSessionId ) {
		setRetainedSessionId( sessionId );
	}
	if ( activeView === 'settings' && ! hasVisitedSettings ) {
		setHasVisitedSettings( true );
	}
	if ( activeView === 'settings' && settingsTab !== retainedSettingsTab ) {
		setRetainedSettingsTab( settingsTab );
	}

	const chatActive = activeView === 'chat';
	const settingsActive = activeView === 'settings';
	const renderedSessionId = sessionId ?? retainedSessionId;

	return (
		<div className={ styles.root }>
			{ chatActive || renderedSessionId ? (
				<div
					className={ `${ styles.layer } ${ chatActive ? styles.layerActive : '' }` }
					inert={ ! chatActive }
					aria-hidden={ ! chatActive || undefined }
				>
					{ renderedSessionId ? (
						<SessionView key={ renderedSessionId } sessionId={ renderedSessionId } />
					) : (
						<SignedOutSessionView siteId={ siteId } />
					) }
				</div>
			) : null }
			{ settingsActive || hasVisitedSettings ? (
				<div
					className={ `${ styles.layer } ${ settingsActive ? styles.layerActive : '' }` }
					inert={ ! settingsActive }
					aria-hidden={ ! settingsActive || undefined }
				>
					<SiteSettingsPage
						siteId={ siteId }
						activeTab={ settingsActive ? settingsTab : retainedSettingsTab }
						onTabChange={ onSettingsTabChange }
					/>
				</div>
			) : null }
		</div>
	);
}
