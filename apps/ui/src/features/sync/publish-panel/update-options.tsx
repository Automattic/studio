import { __ } from '@wordpress/i18n';
import { useId, type ReactNode } from 'react';
import { Button, Checkbox, Field, FieldLabel } from '@/lib/ui';
import { checkNodes } from './selection';
import styles from './update-options.module.css';
import type { TransferSelection } from './use-transfer-selection';

function Option( {
	label,
	description,
	checked,
	indeterminate,
	disabled,
	onChange,
}: {
	label: string;
	description?: string;
	checked: boolean;
	indeterminate?: boolean;
	disabled?: boolean;
	onChange: ( checked: boolean ) => void;
} ) {
	const id = useId();
	return (
		<Field orientation="horizontal" className={ styles.row }>
			<Checkbox
				className={ styles.checkbox }
				id={ id }
				checked={ checked }
				indeterminate={ indeterminate }
				disabled={ disabled }
				onCheckedChange={ onChange }
			/>
			<FieldLabel htmlFor={ id } className={ styles.label }>
				<span>{ label }</span>
				{ description ? <span className={ styles.description }>{ description }</span> : null }
			</FieldLabel>
		</Field>
	);
}

export function PublishChecklist( {
	selection,
	children,
}: {
	selection: TransferSelection;
	children?: ReactNode;
} ) {
	const groups = [
		{ name: 'plugins', label: __( 'Plugins' ) },
		{ name: 'themes', label: __( 'Themes' ) },
		{ name: 'uploads', label: __( 'Uploads' ) },
	];
	const nodes =
		selection.scope === 'custom'
			? selection.nodes
			: checkNodes( selection.nodes, selection.scope !== 'content' );
	const content = selection.scope === 'custom' ? selection.content : selection.scope !== 'files';
	const categoryNodes = nodes.filter( ( node ) =>
		groups.some( ( group ) => group.name === node.name )
	);
	const all = content && nodes.every( ( node ) => node.checked );
	const some = content || categoryNodes.some( ( node ) => node.checked || node.indeterminate );
	const save = ( nextNodes: typeof nodes, nextContent: boolean ) => {
		const categories = nextNodes.filter( ( node ) =>
			groups.some( ( group ) => group.name === node.name )
		);
		if ( ! nextContent && ! categories.some( ( node ) => node.checked || node.indeterminate ) )
			return;
		const everything = nextContent && categories.every( ( node ) => node.checked );
		selection.restore( {
			scope: everything ? 'all' : 'custom',
			nodes: everything
				? checkNodes( nextNodes, true )
				: nextNodes.map( ( node ) =>
						categories.includes( node ) ? node : checkNodes( [ node ], false )[ 0 ]
				  ),
			content: nextContent,
		} );
	};
	return (
		<div>
			<div className={ styles.selection }>
				<Option
					label={ __( 'Everything' ) }
					checked={ all }
					indeterminate={ ! all && some }
					disabled={ selection.loadingFiles || all }
					onChange={ () => save( checkNodes( nodes, true ), true ) }
				/>
				<hr className={ styles.divider } />
				<Option
					label={ __( 'Database' ) }
					description={ __( 'Posts, pages, and settings' ) }
					checked={ content }
					disabled={
						selection.loadingFiles ||
						( content && ! categoryNodes.some( ( node ) => node.checked || node.indeterminate ) )
					}
					onChange={ ( checked ) => {
						save( nodes, checked );
					} }
				/>
				{ groups.map( ( group ) => {
					const node = nodes.find( ( item ) => item.name === group.name );
					return (
						<Option
							key={ group.name }
							label={ group.label }
							checked={ node?.checked ?? selection.scope === 'all' }
							indeterminate={ node?.indeterminate }
							disabled={
								! node ||
								selection.loadingFiles ||
								( ! content &&
									!! node.checked &&
									! categoryNodes.some(
										( item ) => item.id !== node.id && ( item.checked || item.indeterminate )
									) )
							}
							onChange={ ( checked ) => {
								if ( node ) {
									save(
										nodes.map( ( item ) =>
											item.id === node.id ? checkNodes( [ item ], checked )[ 0 ] : item
										),
										content
									);
								}
							} }
						/>
					);
				} ) }
			</div>
			{ children }
			{ selection.error ? (
				<p role="alert">
					{ __( 'Publish options could not be loaded.' ) }{ ' ' }
					<Button variant="inline-link" size="inline" onClick={ selection.retry }>
						{ __( 'Retry' ) }
					</Button>
				</p>
			) : null }
			{ selection.blocked ? (
				<p role="status">{ selection.warning ?? __( 'Select something to publish.' ) }</p>
			) : null }
		</div>
	);
}
