import { Dialog as BaseDialog } from '@base-ui/react/dialog';
import { forwardRef } from 'react';
import styles from './style.module.css';
import type { ComponentPropsWithoutRef, ElementRef, ReactNode } from 'react';

export const Root = BaseDialog.Root;
export const Trigger = BaseDialog.Trigger;
export const Close = BaseDialog.Close;

type PopupProps = {
	children: ReactNode;
	className?: string;
};

/**
 * Wraps Portal + Backdrop + Popup so consumers only need one component.
 * Styled to match the app's neutral surface tokens, mirroring the menu popup.
 */
export const Popup = forwardRef< ElementRef< typeof BaseDialog.Popup >, PopupProps >(
	function Popup( { children, className }, ref ) {
		return (
			<BaseDialog.Portal>
				<BaseDialog.Backdrop className={ styles.backdrop } />
				<BaseDialog.Popup ref={ ref } className={ `${ styles.popup } ${ className ?? '' }` }>
					{ children }
				</BaseDialog.Popup>
			</BaseDialog.Portal>
		);
	}
);

type TitleProps = ComponentPropsWithoutRef< typeof BaseDialog.Title >;

export const Title = forwardRef< ElementRef< typeof BaseDialog.Title >, TitleProps >(
	function Title( { className, children, ...props }, ref ) {
		return (
			<BaseDialog.Title
				ref={ ref }
				className={ `${ styles.title } ${ className ?? '' }` }
				{ ...props }
			>
				{ children }
			</BaseDialog.Title>
		);
	}
);

type DescriptionProps = ComponentPropsWithoutRef< typeof BaseDialog.Description >;

export const Description = forwardRef<
	ElementRef< typeof BaseDialog.Description >,
	DescriptionProps
>( function Description( { className, children, ...props }, ref ) {
	return (
		<BaseDialog.Description
			ref={ ref }
			className={ `${ styles.description } ${ className ?? '' }` }
			{ ...props }
		>
			{ children }
		</BaseDialog.Description>
	);
} );

export function Actions( { children }: { children: ReactNode } ) {
	return <div className={ styles.actions }>{ children }</div>;
}
