import { __ } from '@wordpress/i18n';
import { privateApis } from '@wordpress/theme';
import { IconButton } from '@wordpress/ui';
import { clsx } from 'clsx';
import { useCallback, useEffect, useState } from 'react';
import { AppMessageCards, AppMessageCardsDot } from '@/components/app-message-cards';
import { AppToasts } from '@/components/app-toasts';
import { ResizeHandle, ResizeOverlay } from '@/components/resize-handle';
import { SidebarHeader } from '@/components/sidebar-header';
import { SiteList } from '@/components/site-list';
import { UserMenu } from '@/components/user-menu';
import { useConnector } from '@/data/core';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useResizablePanel } from '@/hooks/use-resizable-panel';
import { SidebarCollapsedContext } from '@/hooks/use-sidebar-collapsed';
import { useTrafficLightSpace } from '@/hooks/use-traffic-light-space';
import { drawerIcon } from '@/lib/icons';
import { SIDEBAR_PANEL_CONFIG, SIDEBAR_PANEL_STORAGE_KEY } from '@/lib/resizable-panels';
import { unlock } from '@/lock-unlock';
import styles from './style.module.css';
import type { CSSProperties, ReactNode } from 'react';

const { ThemeProvider } = unlock( privateApis );

// Dark window chrome behind the sidebar and the content frame, mimicking the
// legacy renderer's `bg-chrome` (rgba(30,30,30,1)) and the wp-admin dark
// chrome. Dark mode goes a step deeper so the chrome still contrasts with
// #1e1e1e content surfaces.
const CHROME_BG_LIGHT = '#1e1e1e';
const CHROME_BG_DARK = '#161616';

export function SidebarLayout( { children }: { children: ReactNode } ) {
	const [ collapsed, setCollapsed ] = useState( false );
	const connector = useConnector();
	const reserveTrafficLightSpace = useTrafficLightSpace();
	const colorScheme = useColorScheme();
	const chromeBg = colorScheme === 'dark' ? CHROME_BG_DARK : CHROME_BG_LIGHT;
	const sidebarResize = useResizablePanel( {
		config: SIDEBAR_PANEL_CONFIG,
		edge: 'right',
		storageKey: SIDEBAR_PANEL_STORAGE_KEY,
	} );
	const toggleSidebar = useCallback( () => {
		setCollapsed( ( value ) => ! value );
	}, [] );
	const sidebarStyle = collapsed
		? undefined
		: ( { '--sidebar-width': `${ sidebarResize.width }px` } as CSSProperties );

	useEffect( () => connector.onToggleSidebar( toggleSidebar ), [ connector, toggleSidebar ] );

	return (
		<SidebarCollapsedContext.Provider value={ collapsed }>
			<div className={ styles.root } style={ { '--app-chrome-bg': chromeBg } as CSSProperties }>
				<aside
					className={ clsx(
						styles.sidebar,
						collapsed && styles.sidebarCollapsed,
						sidebarResize.isResizing && styles.sidebarResizing
					) }
					style={ sidebarStyle }
				>
					{ /* The sidebar sits on the dark window chrome in both color
					     schemes, so its wpds tokens come from a nested dark theme
					     scope. */ }
					<ThemeProvider color={ { bg: chromeBg } }>
						<div className={ styles.sidebarThemeScope }>
							<SidebarHeader onToggleSidebar={ toggleSidebar } />
							<SiteList />
							<div className={ styles.sidebarFooter }>
								{ ! collapsed ? <AppMessageCards className={ styles.sidebarCards } /> : null }
								{ ! collapsed ? <AppToasts className={ styles.sidebarToasts } /> : null }
								<UserMenu />
							</div>
						</div>
					</ThemeProvider>
				</aside>
				{ ! collapsed ? (
					// Same dark theme scope as the sidebar so the indicator's
					// brand token resolves against the dark ramp.
					<ThemeProvider color={ { bg: chromeBg } }>
						<ResizeHandle
							className={ styles.resizeHandle }
							label={ __( 'Resize sidebar' ) }
							minWidth={ sidebarResize.minWidth }
							maxWidth={ sidebarResize.maxWidth }
							width={ sidebarResize.width }
							isResizing={ sidebarResize.isResizing }
							onResizeStart={ sidebarResize.handleResizeStart }
							onKeyDown={ sidebarResize.handleKeyDown }
						/>
					</ThemeProvider>
				) : null }
				<main className={ styles.main }>
					{ collapsed ? (
						<div
							className={ clsx(
								styles.floatingToggle,
								! reserveTrafficLightSpace && styles.floatingToggleFlush
							) }
						>
							<span className={ styles.floatingToggleButton }>
								<IconButton
									variant="minimal"
									tone="neutral"
									size="small"
									icon={ drawerIcon }
									label={ __( 'Show sidebar' ) }
									onClick={ toggleSidebar }
								/>
								<AppMessageCardsDot />
							</span>
						</div>
					) : null }
					{ children }
					{ collapsed ? <AppToasts className={ styles.floatingToasts } fit="content" /> : null }
				</main>
				{ sidebarResize.isResizing ? <ResizeOverlay /> : null }
			</div>
		</SidebarCollapsedContext.Provider>
	);
}
