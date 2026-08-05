import { findAiSessionOwnerSite } from '@studio/common/ai/sessions/owner-site';
import { useNavigate } from '@tanstack/react-router';
import { __ } from '@wordpress/i18n';
import { clsx } from 'clsx';
import { isSiteSettingsTab } from '@/components/site-settings-view';
import { SiteToolbar } from '@/components/site-toolbar';
import * as Tabs from '@/components/tabs';
import { useSessions } from '@/data/queries/use-sessions';
import { pathForSite, useOptionalSessionPreviewUI } from '@/hooks/use-session-ui';
import { useSidebarCollapsed } from '@/hooks/use-sidebar-collapsed';
import { useTrafficLightSpace } from '@/hooks/use-traffic-light-space';
import styles from './style.module.css';
import type { SiteSettingsTabId } from '@/components/site-settings-view';
import type { SiteDetails } from '@/data/core';
import type { ReactNode } from 'react';

export type SiteWorkspaceTabId = 'chat' | 'overview' | SiteSettingsTabId;

interface SiteWorkspaceShellProps {
	site: SiteDetails;
	activeTab: SiteWorkspaceTabId;
	showChat: boolean;
	children?: ReactNode;
}

export function SiteWorkspaceShell( {
	site,
	activeTab,
	showChat,
	children,
}: SiteWorkspaceShellProps ) {
	const navigate = useNavigate();
	const { data: sessions } = useSessions();
	const preview = useOptionalSessionPreviewUI();
	const sidebarCollapsed = useSidebarCollapsed();
	const reserveTrafficLightSpace = useTrafficLightSpace().start;
	const latestSession = sessions
		?.filter( ( session ) => ! session.archived && findAiSessionOwnerSite( [ site ], session ) )
		.sort( ( a, b ) => Date.parse( b.updatedAt ) - Date.parse( a.updatedAt ) )[ 0 ];

	const selectTab = ( tabId: string | null | undefined ) => {
		if ( tabId === 'chat' ) {
			if ( latestSession ) {
				void navigate( {
					to: '/sessions/$sessionId',
					params: { sessionId: latestSession.id },
				} );
				return;
			}
			void navigate( {
				to: '/sites/$siteId/new',
				params: { siteId: site.id },
			} );
			return;
		}

		if ( tabId === 'overview' ) {
			void navigate( {
				to: '/sites/$siteId/overview',
				params: { siteId: site.id },
				...( activeTab === 'chat' ? {} : { replace: true } ),
			} );
			return;
		}

		if ( tabId && isSiteSettingsTab( tabId ) ) {
			void navigate( {
				to: '/sites/$siteId/overview',
				params: { siteId: site.id },
				search: { tab: tabId },
				...( activeTab === 'chat' ? {} : { replace: true } ),
			} );
		}
	};

	return (
		<Tabs.Root selectedTabId={ activeTab } onSelect={ selectTab }>
			<div
				className={ clsx(
					styles.header,
					sidebarCollapsed && reserveTrafficLightSpace && styles.headerSidebarCollapsed
				) }
			>
				<SiteToolbar
					site={ site }
					browserPath={ pathForSite( preview?.pathsBySiteId ?? {}, site.id ) }
				/>
			</div>
			<div className={ styles.tabsBar }>
				<div className={ styles.tabsBarInner }>
					<Tabs.List>
						{ showChat ? <Tabs.Tab tabId="chat">{ __( 'Chat' ) }</Tabs.Tab> : null }
						<Tabs.Tab tabId="overview">{ __( 'Overview' ) }</Tabs.Tab>
						<Tabs.Tab tabId="connections">{ __( 'Connections' ) }</Tabs.Tab>
						<Tabs.Tab tabId="general">{ __( 'Settings' ) }</Tabs.Tab>
					</Tabs.List>
				</div>
			</div>
			{ children }
		</Tabs.Root>
	);
}
