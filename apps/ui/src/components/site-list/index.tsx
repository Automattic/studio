import { Icon, chevronDown, chevronRight, plus } from '@wordpress/icons';
import { useState } from 'react';
import { useSites } from '@/data/queries/use-sites';
import styles from './style.module.css';

export function SiteList() {
	const { data: sites, isLoading } = useSites();
	const [ isCollapsed, setIsCollapsed ] = useState( false );

	return (
		<div className={ styles.root }>
			<div className={ styles.header }>
				<button
					className={ styles.collapseButton }
					onClick={ () => setIsCollapsed( ! isCollapsed ) }
				>
					<span className={ styles.title }>Projects</span>
					<Icon icon={ isCollapsed ? chevronRight : chevronDown } size={ 18 } />
				</button>
				<button className={ styles.stopAllButton }>Stop all</button>
			</div>
			{ ! isCollapsed && (
				<>
					{ isLoading ? (
						<p className={ styles.loading }>Loading...</p>
					) : (
						<ul className={ styles.list }>
							{ sites?.map( ( site ) => (
								<li key={ site.id } className={ styles.item }>
									{ site.name }
								</li>
							) ) }
						</ul>
					) }
					<button className={ styles.addButton }>
						<Icon icon={ plus } size={ 18 } />
						<span>Add site</span>
					</button>
				</>
			) }
		</div>
	);
}
