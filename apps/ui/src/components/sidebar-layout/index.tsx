import { ProjectList } from '@/components/project-list';
import styles from './style.module.css';
import type { ReactNode } from 'react';

export function SidebarLayout( { children }: { children: ReactNode } ) {
	return (
		<div className={ styles.root }>
			<aside className={ styles.sidebar }>
				<ProjectList />
			</aside>
			<main className={ styles.main }>{ children }</main>
		</div>
	);
}
