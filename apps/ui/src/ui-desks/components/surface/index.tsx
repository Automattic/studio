import { clsx } from 'clsx';
import styles from './style.module.css';
import type { ComponentPropsWithoutRef } from 'react';

type SurfaceVariant = 'glass' | 'material';

type SurfaceProps = ComponentPropsWithoutRef< 'div' > & {
	variant?: SurfaceVariant;
};

export function Surface( { className, variant = 'material', ...props }: SurfaceProps ) {
	return <div { ...props } className={ clsx( styles.surface, styles[ variant ], className ) } />;
}

export function Divider( { className, ...props }: ComponentPropsWithoutRef< 'div' > ) {
	return <div { ...props } className={ clsx( styles.divider, className ) } />;
}
