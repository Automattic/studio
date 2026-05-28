import { __ } from '@wordpress/i18n';
import { clsx } from 'clsx';
import { useFullscreen } from '@/hooks/use-fullscreen';
import styles from './style.module.css';
import type { ReactNode } from 'react';

interface DeskHeaderProps {
	children: ReactNode;
	embedded?: boolean;
	centerChildren?: ReactNode;
	rightChildren?: ReactNode;
}

export function DeskHeader( {
	children,
	embedded = false,
	centerChildren,
	rightChildren,
}: DeskHeaderProps ) {
	const isFullscreen = useFullscreen();

	return (
		<div
			className={ clsx(
				styles.root,
				isFullscreen && styles.fullscreen,
				embedded && styles.embedded
			) }
			data-ui-desks-embedded={ embedded ? 'true' : undefined }
		>
			<span className={ styles.title }>{ __( 'Studio' ) }</span>
			<div className={ styles.actions }>{ children }</div>
			{ centerChildren && <div className={ styles.centerActions }>{ centerChildren }</div> }
			{ rightChildren && <div className={ styles.rightActions }>{ rightChildren }</div> }
		</div>
	);
}
