import { getErrorMessage } from '@studio/common/lib/error-formatting';
import { sanitizeFolderName } from '@studio/common/lib/sanitize-folder-name';
import { __ } from '@wordpress/i18n';
import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { useConnector } from '@/data/core';
import { usePathValidator } from '@/data/queries/use-create-site-helpers';
import { useSites } from '@/data/queries/use-sites';
import { useUserPreferences } from '@/data/queries/use-user-preferences';
import { RotateCcwIcon } from '@/lib/icons';
import {
	Button,
	Field,
	FieldDescription,
	FieldLabel,
	IconButton,
	Input,
	InputGroup,
	InputGroupAddon,
	InputGroupInput,
	VisuallyHidden,
} from '@/lib/ui';
import { getFolderNameError, splitFolderPath } from './folder-path';
import styles from './style.module.css';
import type { FormData } from './form-data';

export function PathField( {
	data: item,
	error,
	requiresEmptyPath,
	requiresExistingPath,
	description,
	disabled,
	onChange,
}: {
	data: FormData;
	error: string;
	requiresEmptyPath?: boolean;
	requiresExistingPath?: boolean;
	description?: string;
	disabled?: boolean;
	onChange: ( update: Partial< FormData > ) => void;
} ) {
	const id = useId();
	const connector = useConnector();
	const { data: sites } = useSites();
	const { data: preferences } = useUserPreferences();
	const { selectPath } = usePathValidator( sites, requiresEmptyPath, requiresExistingPath );
	const [ pickerError, setPickerError ] = useState( '' );
	const [ choosing, setChoosing ] = useState( false );
	const [ isNameEmpty, setIsNameEmpty ] = useState( false );
	const [ compactParent, setCompactParent ] = useState( false );
	const request = useRef( 0 );
	const folderInput = useRef< HTMLInputElement >( null );
	const parentAddon = useRef< HTMLDivElement >( null );
	const pathMeasure = useRef< HTMLSpanElement >( null );
	useEffect( () => {
		setChoosing( false );
		setPickerError( '' );
		setIsNameEmpty( false );
		return () => {
			request.current += 1;
		};
	}, [ disabled, requiresEmptyPath, requiresExistingPath ] );
	const parent = preferences?.defaultSiteDirectory ?? '';
	const defaultLocation =
		parent && /[\\/]$/.test( parent ) ? parent : parent + ( parent.includes( '\\' ) ? '\\' : '/' );
	const path = item.hasCustomPath
		? item.path
		: ( item.name.trim() ? item.path : '' ) || ( parent ? defaultLocation : '' );
	const { parent: parentPath, name: folderName } = splitFolderPath( path );
	const suggestedName = sanitizeFolderName( item.name );
	const existing = requiresExistingPath || ( item.isWordPress && ! requiresEmptyPath );
	const hint = existing
		? __( 'Studio will use this WordPress site in place. No files will be moved.' )
		: description;
	const describedBy = [
		hint ? `${ id }-hint` : undefined,
		error || pickerError ? `${ id }-error` : undefined,
	]
		.filter( Boolean )
		.join( ' ' );
	const showReset = item.hasCustomPath && !! suggestedName && folderName !== suggestedName;
	const { parent: ancestor, name: parentName } = splitFolderPath( parentPath.slice( 0, -1 ) );
	const separator = parentPath.slice( -1 );
	const parentDisplay =
		compactParent && ancestor && parentName
			? `…${ separator }${ parentName }${ separator }`
			: parentPath;
	useLayoutEffect( () => {
		const input = folderInput.current;
		const addon = parentAddon.current;
		const measure = pathMeasure.current;
		if ( ! input || ! addon || ! measure ) return;
		const update = () => {
			const padding = [ addon, input ].reduce( ( total, element ) => {
				const style = getComputedStyle( element );
				return total + parseFloat( style.paddingLeft ) + parseFloat( style.paddingRight );
			}, 0 );
			const available = addon.clientWidth + input.clientWidth - padding;
			if ( available > 0 ) setCompactParent( measure.scrollWidth + 2 > available );
		};
		update();
		if ( typeof ResizeObserver === 'undefined' ) return;
		const resize = new ResizeObserver( update );
		resize.observe( input.parentElement! );
		resize.observe( measure );
		return () => resize.disconnect();
	}, [ parentPath, folderName, isNameEmpty, existing, showReset ] );
	const changeFolderName = ( name: string, matchSiteName = false ) => {
		const pathError = matchSiteName && ! item.name.trim() ? '' : getFolderNameError( name );
		setPickerError( '' );
		onChange( {
			path: parentPath + name,
			hasCustomPath: true,
			matchSiteName,
			pathError,
			isWordPress: false,
			isPathPending: ! pathError,
		} );
	};
	const selectFolder = async () => {
		const selection = ++request.current;
		setChoosing( true );
		setPickerError( '' );
		try {
			const result = await selectPath( path );
			if ( selection !== request.current || ! result ) return;
			if ( requiresExistingPath && result.error ) {
				setPickerError( result.error );
				return;
			}
			onChange( {
				path: result.path,
				hasCustomPath: true,
				matchSiteName: false,
				pathError: result.error ?? '',
				isWordPress: result.isWordPress,
				isPathPending: false,
				...( ! item.name && result.name ? { name: result.name } : {} ),
			} );
		} catch ( failure ) {
			if ( selection === request.current )
				setPickerError( getErrorMessage( failure ) ?? __( 'Unable to open this folder.' ) );
		} finally {
			if ( selection === request.current ) setChoosing( false );
		}
	};
	return (
		<Field>
			<FieldLabel htmlFor={ id }>{ __( 'Folder' ) }</FieldLabel>
			<div className={ styles.pathRow }>
				{ existing ? (
					<Input
						id={ id }
						className={ styles.pathDisplay }
						value={ path }
						readOnly
						disabled={ disabled }
						title={ path }
						aria-invalid={ error ? true : undefined }
						aria-describedby={ describedBy || undefined }
					/>
				) : (
					<InputGroup title={ path }>
						<span className={ styles.pathMeasure } aria-hidden="true">
							<span ref={ pathMeasure }>{ parentPath + ( isNameEmpty ? '' : folderName ) }</span>
						</span>
						<InputGroupAddon
							ref={ parentAddon }
							id={ `${ id }-parent` }
							aria-label={ __( 'Parent folder' ) }
							aria-disabled="true"
							className={ styles.pathParent }
							data-compact={ compactParent || undefined }
							title={ path }
						>
							<VisuallyHidden>{ parentPath }</VisuallyHidden>
							<span className={ styles.pathParentText } aria-hidden="true">
								<bdi dir="ltr">{ parentDisplay.slice( 0, -1 ) }</bdi>
							</span>
							<span aria-hidden="true">{ separator }</span>
						</InputGroupAddon>
						<InputGroupInput
							ref={ folderInput }
							id={ id }
							className={ styles.pathName }
							value={ isNameEmpty ? '' : folderName }
							disabled={ disabled || ! parentPath }
							title={ path }
							aria-invalid={ error ? true : undefined }
							aria-describedby={ [ `${ id }-parent`, describedBy ].filter( Boolean ).join( ' ' ) }
							onChange={ ( event ) => {
								const name = event.target.value;
								if ( /[\\/]/.test( name ) ) return;
								const empty = ! name.trim();
								setIsNameEmpty( empty );
								changeFolderName( empty ? suggestedName : name, empty );
							} }
							onBlur={ () => setIsNameEmpty( false ) }
						/>
						{ showReset && (
							<InputGroupAddon align="inline-end">
								<IconButton
									icon={ <RotateCcwIcon /> }
									label={ __( 'Reset folder name to match site name' ) }
									size="icon-xs"
									disabled={ disabled || choosing || ! parentPath }
									onClick={ () => {
										changeFolderName( suggestedName, true );
										folderInput.current?.focus();
									} }
								/>
							</InputGroupAddon>
						) }
					</InputGroup>
				) }
				<Button
					variant="outline"
					disabled={ disabled || choosing || ! connector.capabilities.nativeFolderPicker }
					onClick={ () => void selectFolder() }
				>
					{ __( 'Change…' ) }
				</Button>
			</div>
			{ error || pickerError ? (
				<FieldDescription id={ `${ id }-error` } error={ error || pickerError } />
			) : null }
			{ hint ? <FieldDescription id={ `${ id }-hint` }>{ hint }</FieldDescription> : null }
		</Field>
	);
}
