import { clsx } from 'clsx';
import styles from './style.module.css';

interface SidebarHeaderProps {
	variant?: 'traffic-lights' | 'fullscreen';
}

export function SidebarHeader( { variant = 'traffic-lights' }: SidebarHeaderProps ) {
	return (
		<div
			data-sidebar-header
			className={ clsx( styles.root, variant === 'fullscreen' && styles.fullscreen ) }
		/>
	);
}
