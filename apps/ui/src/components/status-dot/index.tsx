import { clsx } from 'clsx';
import { forwardRef, type ComponentPropsWithoutRef } from 'react';
import styles from './style.module.css';

export type StatusDotStatus = 'loading' | 'waiting-response' | 'finished-response';

interface StatusDotProps extends ComponentPropsWithoutRef< 'span' > {
	status: StatusDotStatus;
}

export const StatusDot = forwardRef< HTMLSpanElement, StatusDotProps >( function StatusDot(
	{ status, className, ...props },
	ref
) {
	return (
		<span ref={ ref } className={ clsx( styles.root, className ) } { ...props }>
			<span className={ clsx( styles.visual, styles[ status ] ) } aria-hidden="true" />
		</span>
	);
} );
