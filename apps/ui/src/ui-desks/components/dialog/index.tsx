import { __ } from '@wordpress/i18n';
import { closeSmall } from '@wordpress/icons';
import { clsx } from 'clsx';
import { useEffect, useRef } from 'react';
import { Button } from '../button';
import styles from './style.module.css';
import type { ComponentPropsWithoutRef, ReactNode } from 'react';

type DialogSize = 'default' | 'narrow' | 'small';
type DialogGap = 'default' | 'compact';

type DialogProps = Omit<
	ComponentPropsWithoutRef< 'form' >,
	'children' | 'onKeyDown' | 'onPointerDown'
> & {
	ariaLabel: string;
	as?: 'div' | 'form';
	children: ReactNode;
	gap?: DialogGap;
	onClose: () => void;
	open?: boolean;
	size?: DialogSize;
};

export function Dialog( {
	ariaLabel,
	as = 'div',
	children,
	className,
	gap = 'default',
	onClose,
	open = true,
	size = 'default',
	...props
}: DialogProps ) {
	const dialogRef = useRef< HTMLDivElement | HTMLFormElement | null >( null );

	useEffect( () => {
		if ( ! open ) {
			return;
		}

		const focusFrame = window.requestAnimationFrame( () => {
			if ( dialogRef.current && ! dialogRef.current.contains( document.activeElement ) ) {
				dialogRef.current.focus();
			}
		} );
		const handleKeyDown = ( event: KeyboardEvent ) => {
			if ( event.key === 'Escape' && ! event.defaultPrevented ) {
				event.preventDefault();
				onClose();
			}
		};

		document.addEventListener( 'keydown', handleKeyDown );
		return () => {
			window.cancelAnimationFrame( focusFrame );
			document.removeEventListener( 'keydown', handleKeyDown );
		};
	}, [ onClose, open ] );

	if ( ! open ) {
		return null;
	}

	const dialogProps = {
		...props,
		className: clsx(
			styles.dialog,
			size === 'narrow' && styles.narrow,
			size === 'small' && styles.small,
			gap === 'compact' && styles.compact,
			className
		),
		role: 'dialog',
		tabIndex: props.tabIndex ?? -1,
		'aria-modal': true,
		'aria-label': ariaLabel,
	};

	return (
		<div
			className={ styles.backdrop }
			onPointerDown={ ( event ) => {
				event.stopPropagation();
				if ( event.target === event.currentTarget ) {
					onClose();
				}
			} }
		>
			{ as === 'form' ? (
				<form
					{ ...( dialogProps as ComponentPropsWithoutRef< 'form' > ) }
					ref={ ( element ) => {
						dialogRef.current = element;
					} }
				>
					{ children }
				</form>
			) : (
				<div
					{ ...( dialogProps as ComponentPropsWithoutRef< 'div' > ) }
					ref={ ( element ) => {
						dialogRef.current = element;
					} }
				>
					{ children }
				</div>
			) }
		</div>
	);
}

export function DialogHeader( {
	children,
	className,
}: {
	children: ReactNode;
	className?: string;
} ) {
	return <div className={ clsx( styles.header, className ) }>{ children }</div>;
}

export function DialogTitle( {
	children,
	className,
}: {
	children: ReactNode;
	className?: string;
} ) {
	return <h2 className={ clsx( styles.title, className ) }>{ children }</h2>;
}

export function DialogCloseButton( {
	className,
	label = __( 'Close' ),
	onClose,
}: {
	className?: string;
	label?: string;
	onClose: () => void;
} ) {
	return (
		<Button
			className={ clsx( styles.closeButton, className ) }
			icon={ closeSmall }
			label={ label }
			onClick={ onClose }
			size="small"
			variant="quiet"
		/>
	);
}

export function DialogContent( {
	children,
	className,
}: {
	children: ReactNode;
	className?: string;
} ) {
	return <div className={ clsx( styles.content, className ) }>{ children }</div>;
}

export function DialogFooter( {
	align = 'end',
	children,
	className,
}: {
	align?: 'center' | 'end';
	children: ReactNode;
	className?: string;
} ) {
	return (
		<div className={ clsx( styles.footer, align === 'center' && styles.footerCenter, className ) }>
			{ children }
		</div>
	);
}

export function DialogRow( {
	align = 'end',
	children,
	className,
}: {
	align?: 'center' | 'end';
	children: ReactNode;
	className?: string;
} ) {
	return (
		<div className={ clsx( styles.row, align === 'center' && styles.rowCenter, className ) }>
			{ children }
		</div>
	);
}

export function DialogError( { children }: { children: ReactNode } ) {
	return <div className={ styles.error }>{ children }</div>;
}

export function DialogTip( { children }: { children: ReactNode } ) {
	return <p className={ styles.tip }>{ children }</p>;
}

export const dialogInputClassName = styles.input;
