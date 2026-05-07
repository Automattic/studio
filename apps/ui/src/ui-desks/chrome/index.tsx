import { clsx } from 'clsx';
import { useFullscreen } from '@/hooks/use-fullscreen';
import styles from './style.module.css';
import { DeskUserMenu } from './user-menu';

export function DeskChrome() {
	const isFullscreen = useFullscreen();

	return (
		<div className={ clsx( styles.root, isFullscreen && styles.fullscreen ) }>
			<DeskUserMenu />
		</div>
	);
}
