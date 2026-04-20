import { Stack } from '@wordpress/ui';
import styles from './style.module.css';
import type { ReactNode } from 'react';

export function OnboardingLayout( { children }: { children: ReactNode } ) {
	return (
		<Stack align="center" justify="center" className={ styles.root }>
			<div className={ styles.content }>{ children }</div>
		</Stack>
	);
}
