import styles from './style.module.css';
import type { ReactNode } from 'react';

export function OnboardingLayout( { children }: { children: ReactNode } ) {
	return (
		<div className={ styles.root }>
			<div className={ styles.content }>{ children }</div>
		</div>
	);
}
