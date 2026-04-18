import { __ } from '@wordpress/i18n';
import { IconButton } from '@wordpress/ui';
import { useState } from 'react';
import { ProjectList } from '@/components/project-list';
import { SidebarHeader } from '@/components/sidebar-header';
import { UserMenu } from '@/components/user-menu';
import { useFullscreen } from '@/hooks/use-fullscreen';
import styles from './style.module.css';
import type { ReactNode } from 'react';

const drawerIcon = (
	<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none">
		<rect x="4" y="5" width="16" height="14" rx="1.5" stroke="currentColor" strokeWidth="1.5" />
		<line x1="9.5" y1="5" x2="9.5" y2="19" stroke="currentColor" strokeWidth="1.5" />
	</svg>
);

export function SidebarLayout( { children }: { children: ReactNode } ) {
	const [ collapsed, setCollapsed ] = useState( false );
	const isFullscreen = useFullscreen();

	return (
		<div className={ styles.root }>
			<aside className={ `${ styles.sidebar } ${ collapsed ? styles.sidebarCollapsed : '' }` }>
				<SidebarHeader onToggleSidebar={ () => setCollapsed( true ) } />
				<div className={ styles.sidebarContent }>
					<ProjectList />
				</div>
				<UserMenu />
			</aside>
			<main className={ styles.main }>
				{ collapsed ? (
					<div
						className={ `${ styles.floatingToggle } ${
							isFullscreen ? styles.floatingToggleFullscreen : ''
						}` }
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
	);
}
