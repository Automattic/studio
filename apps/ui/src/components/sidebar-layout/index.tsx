import { SiteList } from '@/components/site-list';
import styles from './style.module.css';
import type { ReactNode } from 'react';

export function SidebarLayout( { children }: { children: ReactNode } ) {
	return (
		<div className={ styles.root }>
			<aside className={ styles.sidebar }>
				<div className={ styles.separator } />
				<SiteList />
			</aside>
			<main className={ styles.main }>{ children }</main>
		</div>
	);
}
