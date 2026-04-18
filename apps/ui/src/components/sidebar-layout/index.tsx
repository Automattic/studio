import { ProjectList } from '@/components/project-list';
import { UserMenu } from '@/components/user-menu';
import styles from './style.module.css';
import type { ReactNode } from 'react';

export function SidebarLayout( { children }: { children: ReactNode } ) {
	return (
		<div className={ styles.root }>
			<aside className={ styles.sidebar }>
				<div className={ styles.sidebarContent }>
					<ProjectList />
				</div>
				<UserMenu />
			</aside>
			<main className={ styles.main }>{ children }</main>
		</div>
	);
}
