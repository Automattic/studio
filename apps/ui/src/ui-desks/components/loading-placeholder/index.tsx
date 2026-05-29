import { clsx } from 'clsx';
import styles from './style.module.css';
import type { ComponentPropsWithoutRef } from 'react';

type LoadingPlaceholderProps = ComponentPropsWithoutRef< 'div' > & {
	text?: string;
};

export function LoadingPlaceholder( { className, text, ...props }: LoadingPlaceholderProps ) {
	return (
		<div { ...props } className={ clsx( styles.placeholder, className ) }>
			{ text && <div className={ styles.title }>{ text }</div> }
			<div className={ styles.line } />
			<div className={ styles.shortLine } />
		</div>
	);
}
