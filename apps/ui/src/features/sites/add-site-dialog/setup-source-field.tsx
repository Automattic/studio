import { getErrorMessage } from '@studio/common/lib/error-formatting';
import { __ } from '@wordpress/i18n';
import { FileArchiveIcon, FileIcon, FolderIcon, LayoutTemplateIcon, XIcon } from 'lucide-react';
import { useId, useRef, useState } from 'react';
import { toast } from '@/data/app-messages';
import { useConnector } from '@/data/core';
import { SITE_FILE_UPLOAD_TYPES } from '@/features/sites/blueprint-upload';
import { ShuffleIcon } from '@/lib/icons';
import {
	Button,
	DropZone,
	Field,
	FieldTitle,
	IconButton,
	Menu,
	PreviewFrame,
	PreviewImage,
} from '@/lib/ui';
import { getBlueprintThumbnail } from './blueprint-screenshots';
import { useAddSite } from './context';
import styles from './style.module.css';

export function SetupSourceField( { disabled = false }: { disabled?: boolean } ) {
	const labelId = useId();
	const { source, setSource, browseBlueprints, onFile, onFolder, removeFolder, isBlueprintValid } =
		useAddSite();
	const connector = useConnector();
	const [ choosing, setChoosing ] = useState( false );
	const fileInput = useRef< HTMLInputElement >( null );
	const blueprint = source.type === 'blueprint' ? source.blueprint : undefined;
	const backup = source.type === 'import' ? source.backup : undefined;
	const remote = source.type === 'connect' ? source.remote : undefined;
	const folder = source.type === 'folder' ? source.folder : undefined;
	const selected = blueprint
		? blueprint.slug
			? blueprint.title
			: blueprint.file.name
		: backup?.name ?? remote?.name ?? folder?.name;
	const image = blueprint?.image
		? getBlueprintThumbnail( { slug: blueprint.slug ?? '', image: blueprint.image } )
		: undefined;
	const description = blueprint
		? __( 'Blueprint' )
		: backup
		? backup.name.toLowerCase().endsWith( '.xml' )
			? __( 'WordPress export' )
			: __( 'Site backup' )
		: folder
		? __( 'Existing WordPress site' )
		: remote
		? remote.url
		: '';
	const chooseFile = async () => {
		if ( ! connector.capabilities.nativeFolderPicker ) {
			fileInput.current?.click();
			return;
		}
		setChoosing( true );
		try {
			await onFolder();
		} catch ( error ) {
			toast.error( getErrorMessage( error ) ?? __( 'Unable to open this source.' ) );
		} finally {
			setChoosing( false );
		}
	};
	const actions = (
		<Button
			variant="outline"
			disabled={ disabled || choosing || ! isBlueprintValid }
			onClick={ () => void chooseFile() }
			data-site-file-upload
		>
			{ __( 'Choose…' ) }
		</Button>
	);
	return (
		<Field aria-labelledby={ labelId }>
			<FieldTitle id={ labelId } className={ styles.briefTitle }>
				{ __( 'Start from' ) }
				<span className={ styles.briefOptional }>{ __( '(optional)' ) }</span>
			</FieldTitle>
			<input
				ref={ fileInput }
				type="file"
				aria-label={ __( 'Choose a Blueprint or backup' ) }
				accept={ SITE_FILE_UPLOAD_TYPES.join( ',' ) }
				className={ styles.fileInput }
				disabled={ disabled }
				onChange={ ( event ) => {
					const file = event.target.files?.[ 0 ];
					if ( file ) onFile( file );
					event.target.value = '';
				} }
			/>
			<div className={ styles.sourceArea }>
				{ selected ? (
					<div className={ styles.selectedSource }>
						{ image ? (
							<PreviewFrame className={ styles.sourceThumbnail }>
								<PreviewImage
									key={ image }
									src={ image }
									alt={ __( 'Blueprint preview' ) }
									className={ styles.sourceScreenshot }
								/>
							</PreviewFrame>
						) : (
							<div className={ styles.sourceIcon } aria-hidden="true">
								{ blueprint ? (
									<LayoutTemplateIcon />
								) : folder ? (
									<FolderIcon />
								) : backup ? (
									<FileArchiveIcon />
								) : (
									<FileIcon />
								) }
							</div>
						) }
						<div className={ styles.sourceInfo }>
							<span className={ styles.selectedSourceName } title={ selected }>
								{ selected }
							</span>
							<span className={ styles.sourceDescription } title={ description }>
								{ description }
							</span>
						</div>
						{ folder ? (
							<Button
								variant="inline-text"
								size="inline"
								disabled={ disabled }
								onClick={ removeFolder }
							>
								{ __( 'Remove' ) }
							</Button>
						) : blueprint ? (
							<div className={ styles.sourceActions }>
								<IconButton
									icon={ <ShuffleIcon /> }
									label={ __( 'Browse Blueprints' ) }
									size="icon-xs"
									disabled={ disabled }
									onClick={ browseBlueprints }
								/>
								<IconButton
									icon={ <XIcon /> }
									label={ __( 'Remove Blueprint' ) }
									size="icon-xs"
									disabled={ disabled }
									onClick={ () => setSource( { type: 'blank' } ) }
								/>
							</div>
						) : (
							<Menu.Root>
								<Menu.Trigger
									render={ <Button variant="inline-text" size="inline" disabled={ disabled } /> }
								>
									{ __( 'Change' ) }
								</Menu.Trigger>
								<Menu.Popup side="bottom" align="end">
									<Menu.Item onClick={ browseBlueprints }>{ __( 'Browse Blueprints' ) }</Menu.Item>
									<Menu.Item onClick={ () => void chooseFile() }>
										{ connector.capabilities.nativeFolderPicker
											? __( 'Choose…' )
											: __( 'Choose file' ) }
									</Menu.Item>
									<Menu.Item
										onClick={ () => {
											setSource( { type: 'blank' } );
										} }
									>
										{ __( 'Start blank' ) }
									</Menu.Item>
								</Menu.Popup>
							</Menu.Root>
						) }
					</div>
				) : null }
				{ ! selected && (
					<DropZone
						className={ styles.sourceDropZone }
						size="sm"
						title={ null }
						description={ __(
							'Choose an existing WordPress folder, blueprint, backup, or export.'
						) }
					>
						{ actions }
					</DropZone>
				) }
			</div>
		</Field>
	);
}
