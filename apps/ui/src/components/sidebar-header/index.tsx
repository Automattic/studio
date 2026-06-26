import { useFullscreen } from '@/hooks/use-fullscreen';
import styles from './style.module.css';

export function SidebarHeader() {
	const isFullscreen = useFullscreen();
	return (
		<div className={ `${ styles.root } ${ isFullscreen ? styles.fullscreen : '' }` } aria-hidden />
	);
}
