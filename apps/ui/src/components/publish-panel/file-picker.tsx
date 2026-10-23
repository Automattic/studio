import { __, sprintf } from '@wordpress/i18n';
import { chevronDown, chevronRight, Icon, link } from '@wordpress/icons';
import { useId, useState, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Field, FieldLabel } from '@/components/ui/field';
import { Spinner } from '@/components/ui/spinner';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
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
			<Field orientation="horizontal">
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
				<FieldLabel htmlFor={ id } className={ styles.selectionLabel }>
					{ label }
				</FieldLabel>
			</Field>
			{ symlink ? (
				<Tooltip>
					<TooltipTrigger render={ <span className={ styles.symlink } /> }>
						<Icon icon={ link } size={ 16 } />
					</TooltipTrigger>
					<TooltipContent>
						{ __( 'Symbolic link. Studio pushes the files it points to.' ) }
					</TooltipContent>
				</Tooltip>
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
						<Button
							variant="ghost"
							size="icon-xs"
							aria-label={ sprintf(
								/* translators: %s: folder name */
								expanded ? __( 'Collapse %s' ) : __( 'Expand %s' ),
								node.name
							) }
							aria-expanded={ expanded }
							disabled={ loading }
							onClick={ toggle }
						>
							{ loading ? <Spinner /> : <Icon icon={ expanded ? chevronDown : chevronRight } /> }
						</Button>
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
