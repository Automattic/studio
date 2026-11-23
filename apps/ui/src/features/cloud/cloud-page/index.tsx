import { WordPressIcon } from '@studio/ds/icons';
import { __ } from '@wordpress/i18n';
import styles from '../style.module.css';
import type { ReactNode } from 'react';

/** The frame of Studio Cloud's pages before the workspace opens. */
export function CloudPage( { action, children }: { action: ReactNode; children: ReactNode } ) {
	return (
		<div className={ styles.page }>
			<header className={ styles.header }>
				<div className={ styles.headerInner }>
					<a className={ styles.brand } href="https://wordpress.studio">
						<span className={ styles.logo }>
							<WordPressIcon width={ 22 } height={ 22 } />
						</span>
						{ __( 'WordPress Studio' ) }
					</a>
					{ action }
				</div>
			</header>
			<main>
				<section className={ styles.section }>{ children }</section>
			</main>
		</div>
	);
}
