import { __ } from '@wordpress/i18n';
import { IconButton } from '@wordpress/ui';
import { clsx } from 'clsx';
import { useState } from 'react';
import { ProjectList } from '@/components/project-list';
import { SidebarHeader } from '@/components/sidebar-header';
import { SidebarNav } from '@/components/sidebar-nav';
import { UserMenu } from '@/components/user-menu';
import { useFullscreen } from '@/hooks/use-fullscreen';
import { SidebarCollapsedContext } from '@/hooks/use-sidebar-collapsed';
import { drawerIcon } from '@/lib/icons';
import styles from './style.module.css';
import type { ReactNode } from 'react';

export function SidebarLayout( { children }: { children: ReactNode } ) {
	const [ collapsed, setCollapsed ] = useState( false );
	const isFullscreen = useFullscreen();

	return (
		<SidebarCollapsedContext.Provider value={ collapsed }>
			<div className={ styles.root }>
				<aside className={ clsx( styles.sidebar, collapsed && styles.sidebarCollapsed ) }>
					<SidebarHeader onToggleSidebar={ () => setCollapsed( true ) } />
					<div className={ styles.sidebarContent }>
						<SidebarNav />
						<ProjectList />
					</div>
					<UserMenu />
				</aside>
				<main className={ styles.main }>
					{ collapsed ? (
						<div
							className={ clsx(
								styles.floatingToggle,
								isFullscreen && styles.floatingToggleFullscreen
							) }
						>
							<IconButton
								variant="minimal"
								tone="neutral"
								size="small"
								icon={ drawerIcon }
								label={ __( 'Show sidebar' ) }
								onClick={ () => setCollapsed( false ) }
							/>
						</div>
					) : null }
					{ children }
				</main>
			</div>
		</SidebarCollapsedContext.Provider>
	);
}
