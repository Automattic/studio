import { clsx } from 'clsx';
import { useFullscreen } from '@/hooks/use-fullscreen';
import styles from './style.module.css';
import type { ReactNode } from 'react';

interface DeskHeaderProps {
	children: ReactNode;
	centerChildren?: ReactNode;
	rightChildren?: ReactNode;
}

export function DeskHeader( { children, centerChildren, rightChildren }: DeskHeaderProps ) {
	const isFullscreen = useFullscreen();

	return (
		<div className={ clsx( styles.root, isFullscreen && styles.fullscreen ) }>
			<div className={ styles.actions }>{ children }</div>
			{ centerChildren && <div className={ styles.centerActions }>{ centerChildren }</div> }
			{ rightChildren && <div className={ styles.rightActions }>{ rightChildren }</div> }
		</div>
	);
}
