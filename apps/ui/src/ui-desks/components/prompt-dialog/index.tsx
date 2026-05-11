import { arrowUp } from '@wordpress/icons';
import { clsx } from 'clsx';
import { IconControlButton } from '@/ui-desks/components/control-button';
import styles from './style.module.css';
import type { ComponentPropsWithoutRef, ReactNode } from 'react';

type PromptDialogSize = 'default' | 'narrow';
type PromptDialogGap = 'default' | 'compact';

type PromptDialogProps = Omit<
	ComponentPropsWithoutRef< 'form' >,
	'onKeyDown' | 'onPointerDown'
> & {
	ariaLabel: string;
	children: ReactNode;
	gap?: PromptDialogGap;
	onClose: () => void;
	size?: PromptDialogSize;
};

export function PromptDialog( {
	ariaLabel,
	children,
	className,
	gap = 'default',
	onClose,
	size = 'default',
	...props
}: PromptDialogProps ) {
	return (
		<div
			className={ styles.backdrop }
			onPointerDown={ ( event ) => {
				event.stopPropagation();
				if ( event.target === event.currentTarget ) {
					onClose();
				}
			} }
			onKeyDown={ ( event ) => {
				if ( event.key === 'Escape' ) {
					event.preventDefault();
					onClose();
				}
			} }
		>
			<form
				{ ...props }
				className={ clsx(
					styles.dialog,
					size === 'narrow' && styles.narrow,
					gap === 'compact' && styles.compact,
					className
				) }
				role="dialog"
				aria-modal="true"
				aria-label={ ariaLabel }
			>
				{ children }
			</form>
		</div>
	);
}

export function PromptDialogRow( {
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

type PromptDialogSubmitProps = Omit<
	ComponentPropsWithoutRef< typeof IconControlButton >,
	'icon' | 'iconSize' | 'variant' | 'tooltipSide'
>;

export function PromptDialogSubmit( { className, ...props }: PromptDialogSubmitProps ) {
	return (
		<IconControlButton
			{ ...props }
			icon={ arrowUp }
			iconSize={ 24 }
			className={ clsx( styles.submit, className ) }
			variant="toolbar"
			tooltipSide="left"
		/>
	);
}

export function PromptDialogError( { children }: { children: ReactNode } ) {
	return <div className={ styles.error }>{ children }</div>;
}

export const promptDialogInputClassName = styles.input;
