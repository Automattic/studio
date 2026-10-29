import { clsx } from 'clsx';
import styles from './style.module.css';
import type { ComponentProps } from 'react';

export function Table( { className, ...props }: ComponentProps< 'table' > ) {
	return (
		<div className={ styles.container } data-slot="table-container">
			<table className={ clsx( styles.table, className ) } data-slot="table" { ...props } />
		</div>
	);
}

export function TableHeader( { className, ...props }: ComponentProps< 'thead' > ) {
	return (
		<thead className={ clsx( styles.header, className ) } data-slot="table-header" { ...props } />
	);
}

export function TableBody( { className, ...props }: ComponentProps< 'tbody' > ) {
	return <tbody className={ clsx( styles.body, className ) } data-slot="table-body" { ...props } />;
}

export function TableRow( { className, ...props }: ComponentProps< 'tr' > ) {
	return <tr className={ clsx( styles.row, className ) } data-slot="table-row" { ...props } />;
}

export function TableHead( { className, ...props }: ComponentProps< 'th' > ) {
	return (
		<th
			scope="col"
			className={ clsx( styles.head, className ) }
			data-slot="table-head"
			{ ...props }
		/>
	);
}

export function TableCell( { className, ...props }: ComponentProps< 'td' > ) {
	return <td className={ clsx( styles.cell, className ) } data-slot="table-cell" { ...props } />;
}
