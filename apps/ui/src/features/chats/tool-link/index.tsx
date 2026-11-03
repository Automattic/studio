import { Button } from '@/lib/ui';
import styles from './style.module.css';
import type { ReactNode } from 'react';

export function ToolLink( {
	icon,
	children,
	...props
}: {
	icon: ReactNode;
	children: ReactNode;
	onClick: () => void;
	'aria-label'?: string;
} ) {
	return (
		<Button variant="unstyled" size="inline" className={ styles.toolLink } { ...props }>
			{ icon }
			{ children }
		</Button>
	);
}
