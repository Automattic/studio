import { clsx } from 'clsx';
import styles from './style.module.css';
import type { ComponentPropsWithoutRef, ReactNode } from 'react';

type ListProps = ComponentPropsWithoutRef< 'div' >;

type ListItemProps = Omit< ComponentPropsWithoutRef< 'button' >, 'children' > & {
	active?: boolean;
	description?: ReactNode;
	label: ReactNode;
};

export function List( { className, ...props }: ListProps ) {
	return <div { ...props } className={ clsx( styles.list, className ) } />;
}

export function ListItem( {
	active = false,
	className,
	description,
	label,
	type = 'button',
	...props
}: ListItemProps ) {
	return (
		<button
			{ ...props }
			className={ clsx( styles.item, className ) }
			data-active={ active ? 'true' : 'false' }
			type={ type }
		>
			<span className={ styles.label }>{ label }</span>
			{ description ? <span className={ styles.description }>{ description }</span> : null }
		</button>
	);
}
