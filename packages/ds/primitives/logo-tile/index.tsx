import { clsx } from 'clsx';
import styles from './style.module.css';
import type { ReactNode } from 'react';

/**
 * A logo framed like an app icon, `--app-icon-size` wide: `svg`, an SVG document in the brand's
 * colors that fills the tile, or else `children`, an icon in the current color on a muted tile.
 */
export function LogoTile( {
	svg,
	children,
	className,
}: {
	svg?: string;
	children?: ReactNode;
	className?: string;
} ) {
	return (
		<span className={ clsx( styles.logo, className ) } aria-hidden="true">
			{ svg ? (
				<span className={ styles.tile } data-brand="" dangerouslySetInnerHTML={ { __html: svg } } />
			) : (
				<span className={ styles.tile }>{ children }</span>
			) }
		</span>
	);
}
