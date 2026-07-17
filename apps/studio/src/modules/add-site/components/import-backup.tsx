import { ACCEPTED_IMPORT_FILE_TYPES } from '@studio/common/constants';
import { isSupportedBackupFilename } from '@studio/common/lib/backup-files';
import {
	__experimentalVStack as VStack,
	__experimentalHStack as HStack,
	__experimentalHeading as Heading,
	__experimentalText as Text,
	Icon,
} from '@wordpress/components';
import { createInterpolateElement } from '@wordpress/element';
import { download } from '@wordpress/icons';
import { useI18n } from '@wordpress/react-i18n';
import { useCallback, useRef, useState } from 'react';
import { ErrorIcon } from 'src/components/error-icon';
import { LearnMoreLink } from 'src/components/learn-more';
import { cx } from 'src/lib/cx';

const formatFileSize = ( bytes: number ) => {
	if ( bytes === 0 ) return '0 Bytes';
	const k = 1024;
	const sizes = [ 'Bytes', 'KB', 'MB', 'GB' ];
	const i = Math.floor( Math.log( bytes ) / Math.log( k ) );
	return Math.round( ( bytes / Math.pow( k, i ) ) * 100 ) / 100 + ' ' + sizes[ i ];
};

const truncateMiddle = ( filename: string, maxLength: number = 30 ): string => {
	if ( filename.length <= maxLength ) {
		return filename;
	}

	const ellipsis = '…';
	const charsToShow = maxLength - ellipsis.length;
	const frontChars = Math.ceil( charsToShow / 2 );
	const backChars = Math.floor( charsToShow / 2 );

	return (
		filename.substring( 0, frontChars ) +
		ellipsis +
		filename.substring( filename.length - backChars )
	);
};

interface ImportBackupProps {
	onFileSelect: ( file?: File ) => void;
	selectedFile?: File | null;
}

const isValidBackupFile = ( file: File ): boolean => {
	return isSupportedBackupFilename( file.name );
};

export default function ImportBackup( {
	onFileSelect,
	selectedFile: initialFile,
}: ImportBackupProps ) {
	const { __ } = useI18n();
	const [ isDragging, setIsDragging ] = useState( false );
	const [ selectedFile, setSelectedFile ] = useState< File | null >( initialFile || null );
	const [ fileError, setFileError ] = useState< string | null >( null );
	const fileInputRef = useRef< HTMLInputElement >( null );

	const handleFileSelection = useCallback(
		( file: File ) => {
			setSelectedFile( file );
			setFileError( null );
			onFileSelect( file );
		},
		[ onFileSelect ]
	);

	const handleDragOver = useCallback( ( e: React.DragEvent ) => {
		e.preventDefault();
		e.stopPropagation();
		setIsDragging( true );
		setFileError( null );
	}, [] );

	const handleDragLeave = useCallback( ( e: React.DragEvent ) => {
		e.preventDefault();
		e.stopPropagation();
		setIsDragging( false );
	}, [] );

	const handleDrop = useCallback(
		( e: React.DragEvent ) => {
			e.preventDefault();
			e.stopPropagation();
			setIsDragging( false );

			const files = Array.from( e.dataTransfer.files );
			if ( files.length === 0 ) {
				return;
			}

			const file = files[ 0 ];
			if ( isValidBackupFile( file ) ) {
				handleFileSelection( file );
			} else {
				setFileError(
					__(
						'This file type is not supported. Please use a .zip, .gz, .gzip, .tar, .tar.gz, .wpress, or .sql file.'
					)
				);
			}
		},
		[ handleFileSelection, __ ]
	);

	const handleFileInputChange = useCallback(
		( e: React.ChangeEvent< HTMLInputElement > ) => {
			const file = e.target.files?.[ 0 ];
			if ( file ) {
				handleFileSelection( file );
			}
		},
		[ handleFileSelection ]
	);

	const handleClick = useCallback( () => {
		fileInputRef.current?.click();
	}, [] );

	const handleRemoveFile = useCallback(
		( e: React.MouseEvent ) => {
			e.stopPropagation();
			setSelectedFile( null );
			setFileError( null );
			onFileSelect();
			if ( fileInputRef.current ) {
				fileInputRef.current.value = '';
			}
		},
		[ onFileSelect ]
	);

	return (
		<VStack className="text-center w-full" alignment="top" spacing={ 0 }>
			<Heading className="text-center text-[32px] text-frame-text mb-[59px]" weight={ 500 }>
				{ __( 'Import from a backup' ) }
			</Heading>

			<div
				className={ cx(
					'w-full max-w-[400px] h-[200px] mx-auto p-12 border-2 rounded-xl',
					'transition-colors cursor-pointer',
					isDragging
						? 'border-blue-500 bg-blue-50'
						: 'border-frame-border hover:border-frame-text-secondary hover:bg-frame-surface'
				) }
				onDragOver={ handleDragOver }
				onDragLeave={ handleDragLeave }
				onDrop={ handleDrop }
				onClick={ handleClick }
				role="button"
				tabIndex={ 0 }
				onKeyDown={ ( e ) => {
					if ( e.key === 'Enter' || e.key === ' ' ) {
						handleClick();
					}
				} }
			>
				{ selectedFile ? (
					<VStack className="items-center justify-center h-full" spacing={ 2 }>
						<Text
							className="text-base font-medium text-frame-text max-w-md px-4"
							weight={ 400 }
							title={ selectedFile.name }
						>
							{ truncateMiddle( selectedFile.name ) }
						</Text>
						<HStack spacing={ 2 } alignment="center">
							<Text className="text-base text-frame-text-secondary">
								{ formatFileSize( selectedFile.size ) }
							</Text>
							<button
								type="button"
								className="text-base text-blue-600 hover:text-blue-700 focus:outline-none"
								onClick={ handleRemoveFile }
							>
								{ __( 'Remove' ) }
							</button>
						</HStack>
					</VStack>
				) : (
					<VStack className="items-center justify-center h-full" spacing={ 2 }>
						<Icon icon={ download } size={ 24 } className="fill-frame-text-secondary" />
						<Heading
							className="text-[14px] leading-4 font-normal text-center text-frame-text-secondary"
							weight="400"
						>
							{ isDragging ? (
								__( 'Drop your backup file here' )
							) : (
								<>
									{ createInterpolateElement(
										__(
											'Import a Jetpack backup or a full-site backup in another format. <learn_more_link />'
										),
										{
											learn_more_link: <LearnMoreLink docsLinksKey="docsImportExport" />,
										}
									) }
								</>
							) }
						</Heading>
					</VStack>
				) }
			</div>

			<input
				ref={ fileInputRef }
				type="file"
				accept={ ACCEPTED_IMPORT_FILE_TYPES.join( ',' ) }
				onChange={ handleFileInputChange }
				className="hidden"
				aria-label={ __( 'Select backup file' ) }
			/>

			{ fileError && (
				<div className="flex items-start justify-center gap-1 text-xs text-red-500 mt-2 max-w-[400px] mx-auto">
					<ErrorIcon className="shrink-0 mt-px fill-current" />
					<span className="text-left">{ fileError }</span>
				</div>
			) }
		</VStack>
	);
}
