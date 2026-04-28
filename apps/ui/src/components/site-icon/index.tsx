import { globe } from '@wordpress/icons';
import { Icon } from '@wordpress/ui';
import { clsx } from 'clsx';
import styles from './style.module.css';
import type { ComponentPropsWithoutRef } from 'react';

type Props = ComponentPropsWithoutRef< 'span' >;

export function SiteIcon( { className, ...props }: Props ) {
	return (
		<span { ...props } className={ clsx( styles.root, className ) } aria-hidden="true">
			<Icon icon={ globe } size={ 12 } />
		</span>
	);
}
