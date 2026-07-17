import styles from './style.module.css';
import type { ReactNode } from 'react';

export function OnboardingFooter( { children }: { children: ReactNode } ) {
	return (
		<>
			<div aria-hidden="true" className={ styles.scrim } />
			<div className={ styles.actions }>{ children }</div>
		</>
	);
}
