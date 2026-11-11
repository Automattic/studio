import { getErrorMessage } from '@studio/common/lib/error-formatting';
import { __ } from '@wordpress/i18n';
import { FileArchiveIcon, FileIcon, LayoutTemplateIcon, XIcon } from 'lucide-react';
import { useId, useRef, useState } from 'react';
import { toast } from '@/data/app-messages';
import { useConnector } from '@/data/core';
import { useFileDrop } from '@/data/use-composer-attachments';
import { SITE_FILE_UPLOAD_TYPES } from '@/features/sites/blueprint-upload';
import { ShuffleIcon } from '@/lib/icons';
import {
	Button,
	DropZone,
	Field,
	FieldTitle,
	IconButton,
	PreviewFrame,
	PreviewImage,
	Spinner,
} from '@/lib/ui';
import { getBlueprintThumbnail } from './blueprint-screenshots';
import { useAddSite } from './context';
import { getRemoteSiteName } from './site-presentation';
import styles from './style.module.css';

export function SetupSourceField( { disabled = false }: { disabled?: boolean } ) {
	const labelId = useId();
	const {
		source,
		setSource,
		browseBlueprints,
		browseSites,
		onFile,
		onFiles,
		onFolder,
		isBlueprintValid,
	} = useAddSite();
	const connector = useConnector();
	const [ choosing, setChoosing ] = useState( false );
	const busy = disabled || choosing || ! isBlueprintValid;
	const [ dropTarget, setDropTarget ] = useState< HTMLDivElement | null >( null );
	const acceptsDrops = ! disabled && ( source.type === 'blueprint' || source.type === 'import' );
	const isDragging = useFileDrop( acceptsDrops ? dropTarget : null, onFiles );
	const fileInput = useRef< HTMLInputElement >( null );
	const blueprint = source.type === 'blueprint' ? source.blueprint : undefined;
	const backup = source.type === 'import' ? source.backup : undefined;
	const remote = source.type === 'connect' ? source.remote : undefined;
	const selected = blueprint
		? blueprint.slug
			? blueprint.title
			: blueprint.file.name
		: backup?.name ?? ( remote ? getRemoteSiteName( remote ) : undefined );
	const image = blueprint?.image
		? getBlueprintThumbnail( { slug: blueprint.slug ?? '', image: blueprint.image } )
		: undefined;
	const description = blueprint
		? __( 'Blueprint' )
		: backup
		? backup.name.toLowerCase().endsWith( '.xml' )
			? __( 'WordPress export' )
			: __( 'Site backup' )
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
	const chooseSource = () => {
		if ( source.type === 'connect' ) browseSites();
		else void chooseFile();
	};
	const removeSource = () => {
		if ( source.type === 'blueprint' ) setSource( { type: 'blueprint' } );
		else if ( source.type === 'import' ) setSource( { type: 'import' } );
		else setSource( { type: 'blank' } );
	};
	const chooseLabel =
		source.type === 'import' ? __( 'Choose backup or export' ) : __( 'Choose file' );
	const removeLabel =
		source.type === 'blueprint'
			? __( 'Remove Blueprint' )
			: source.type === 'connect'
			? __( 'Remove connected site' )
			: __( 'Remove backup or export' );
	return (
		<>
			<input
				ref={ fileInput }
				type="file"
				aria-label={ __( 'Choose a Blueprint or backup' ) }
				accept={ source.type === 'blueprint' ? '.json,.zip' : SITE_FILE_UPLOAD_TYPES.join( ',' ) }
				className={ styles.fileInput }
				disabled={ disabled }
				onChange={ ( event ) => {
					const file = event.target.files?.[ 0 ];
					if ( file ) onFile( file );
					event.target.value = '';
				} }
			/>
			{ source.type !== 'blank' && source.type !== 'folder' ? (
				<Field aria-labelledby={ labelId }>
					<FieldTitle id={ labelId }>{ __( 'Source' ) }</FieldTitle>
					<div
						ref={ setDropTarget }
						className={ styles.sourceArea }
						data-dragging={ ( acceptsDrops && isDragging ) || undefined }
					>
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
								<div className={ styles.sourceActions }>
									{ choosing || ! isBlueprintValid ? <Spinner aria-hidden="true" /> : null }
									{ blueprint ? (
										<IconButton
											icon={ <ShuffleIcon /> }
											label={ __( 'Browse Blueprints' ) }
											size="icon-xs"
											disabled={ busy }
											onClick={ browseBlueprints }
										/>
									) : (
										<Button
											variant="inline-text"
											size="inline"
											disabled={ busy }
											onClick={ chooseSource }
										>
											{ __( 'Change' ) }
										</Button>
									) }
									<IconButton
										icon={ <XIcon /> }
										label={ removeLabel }
										size="icon-xs"
										disabled={ busy }
										onClick={ removeSource }
									/>
								</div>
							</div>
						) : (
							<DropZone
								className={ styles.sourceDropZone }
								size="sm"
								title={ null }
								description={
									source.type === 'blueprint'
										? __( 'Drop a Blueprint here, choose a file, or browse Blueprints.' )
										: __( 'Drop a site backup or WordPress export here.' )
								}
							>
								<div className={ styles.sourcePickerActions }>
									{ source.type === 'blueprint' ? (
										<Button
											variant="outline"
											disabled={ disabled || ! isBlueprintValid }
											onClick={ browseBlueprints }
										>
											{ __( 'Browse Blueprints' ) }
										</Button>
									) : null }
									<Button
										variant="outline"
										disabled={ busy }
										loading={ choosing || ! isBlueprintValid }
										onClick={ chooseSource }
										data-site-file-upload
									>
										{ chooseLabel }
									</Button>
								</div>
							</DropZone>
						) }
					</div>
				</Field>
			) : null }
		</>
	);
}
