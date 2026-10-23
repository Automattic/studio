import { clsx } from 'clsx';
import styles from './style.module.css';
import type { ComponentProps } from 'react';

export function Empty( { className, ...props }: ComponentProps< 'div' > ) {
	return <div data-slot="empty" className={ clsx( styles.empty, className ) } { ...props } />;
}

export function EmptyHeader( { className, ...props }: ComponentProps< 'div' > ) {
	return (
		<div data-slot="empty-header" className={ clsx( styles.header, className ) } { ...props } />
	);
}

export function EmptyMedia( { className, ...props }: ComponentProps< 'div' > ) {
	return <div data-slot="empty-media" className={ clsx( styles.media, className ) } { ...props } />;
}

export function EmptyTitle( { className, ...props }: ComponentProps< 'div' > ) {
	return <div data-slot="empty-title" className={ clsx( styles.title, className ) } { ...props } />;
}

export function EmptyDescription( { className, ...props }: ComponentProps< 'p' > ) {
	return (
		<p
			data-slot="empty-description"
			className={ clsx( styles.description, className ) }
			{ ...props }
		/>
	);
}
