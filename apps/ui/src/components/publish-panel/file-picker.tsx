import { __, sprintf } from '@wordpress/i18n';
import { chevronDown, chevronRight, link } from '@wordpress/icons';
import { Checkbox, Icon, Spinner, Tooltip } from '@wordpress/ui';
import { useId, useState, type ReactNode } from 'react';
import styles from './style.module.css';
import type { SyncNode } from './selection';
import type { TransferSelection } from './use-transfer-selection';

function SelectionRow( {
	label,
	checked,
	indeterminate,
	symlink,
	onChange,
	disclosure,
}: {
	label: string;
	checked: boolean;
	indeterminate?: boolean;
	symlink?: boolean;
	onChange: ( checked: boolean ) => void;
	disclosure?: ReactNode;
} ) {
	const id = useId();
	return (
		<div className={ styles.selectionRow }>
			<div className={ styles.disclosure }>{ disclosure }</div>
			<Checkbox
				id={ id }
				checked={ checked }
				indeterminate={ indeterminate }
				onCheckedChange={ onChange }
				aria-label={
					/* translators: %s: file or folder name */
					symlink ? sprintf( __( '%s (symbolic link)' ), label ) : undefined
				}
			/>
			<label htmlFor={ id } className={ styles.selectionLabel }>
				{ label }
			</label>
			{ symlink ? (
				<Tooltip.Root>
					<Tooltip.Trigger render={ <span className={ styles.symlink } /> }>
						<Icon icon={ link } size={ 16 } />
					</Tooltip.Trigger>
					<Tooltip.Popup>
						{ __( 'Symbolic link. Studio pushes the files it points to.' ) }
					</Tooltip.Popup>
				</Tooltip.Root>
			) : null }
		</div>
	);
}

function FileNode( { node, selection }: { node: SyncNode; selection: TransferSelection } ) {
	const [ expanded, setExpanded ] = useState( false );
	const [ loading, setLoading ] = useState( false );
	const [ error, setError ] = useState< unknown >();
	const toggle = async () => {
		if ( ! expanded && ! node.children ) {
			setLoading( true );
			setError( undefined );
			try {
				await selection.load( node );
			} catch ( cause ) {
				setError( cause );
				return;
			} finally {
				setLoading( false );
			}
		}
		setExpanded( ! expanded );
	};
	return (
		<div className={ styles.fileNode }>
			<SelectionRow
				label={ node.name }
				checked={ node.checked }
				indeterminate={ node.indeterminate }
				symlink={ node.symlink }
				onChange={ ( checked ) => selection.change( node.id, checked ) }
				disclosure={
					node.expandable ? (
						<button
							type="button"
							className={ styles.disclosureButton }
							aria-label={ sprintf(
								/* translators: %s: folder name */
								expanded ? __( 'Collapse %s' ) : __( 'Expand %s' ),
								node.name
							) }
							aria-expanded={ expanded }
							disabled={ loading }
							onClick={ toggle }
						>
							{ loading ? (
								<Spinner />
							) : (
								<Icon icon={ expanded ? chevronDown : chevronRight } size={ 16 } />
							) }
						</button>
					) : null
				}
			/>
			{ error ? (
				<p role="alert" className={ styles.error }>
					{ error instanceof Error ? error.message : String( error ) }
				</p>
			) : null }
			{ expanded ? (
				<div className={ styles.fileChildren }>
					{ node.children?.map( ( child ) => (
						<FileNode key={ child.id } node={ child } selection={ selection } />
					) ) }
				</div>
			) : null }
		</div>
	);
}

export function FilePicker( { selection }: { selection: TransferSelection } ) {
	return (
		<div className={ styles.stack }>
			<p className={ styles.text }>{ __( 'Choose what to include in this transfer.' ) }</p>
			{ selection.loadingFiles ? (
				<Spinner />
			) : (
				<>
					{ selection.nodes.map( ( node ) => (
						<FileNode key={ node.id } node={ node } selection={ selection } />
					) ) }
					{ selection.nodes.length ? null : (
						<p className={ styles.text }>
							{ __(
								'Individual files are unavailable here. Use Files only to include all files.'
							) }
						</p>
					) }
					<SelectionRow
						label={ __( 'Content and settings' ) }
						checked={ selection.content }
						onChange={ selection.setContent }
					/>
				</>
			) }
		</div>
	);
}
