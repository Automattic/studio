import {
	__experimentalVStack as VStack,
	__experimentalHStack as HStack,
	__experimentalHeading as Heading,
	__experimentalText as Text,
	Icon,
} from '@wordpress/components';
import { sprintf } from '@wordpress/i18n';
import { download } from '@wordpress/icons';
import { useI18n } from '@wordpress/react-i18n';
import { useCallback, useRef, useState, useMemo } from 'react';
import { ACCEPTED_IMPORT_FILE_TYPES } from 'src/constants';
import { cx } from 'src/lib/cx';

interface ImportBackupProps {
	onFileSelect: ( file?: File ) => void;
}

export default function ImportBackup( { onFileSelect }: ImportBackupProps ) {
	const { __ } = useI18n();
	const [ isDragging, setIsDragging ] = useState( false );
	const [ selectedFile, setSelectedFile ] = useState< File | null >( null );
	const fileInputRef = useRef< HTMLInputElement >( null );

	const handleFileSelection = useCallback(
		( file: File ) => {
			setSelectedFile( file );
			onFileSelect( file );
		},
		[ onFileSelect ]
	);

	const handleDragOver = useCallback( ( e: React.DragEvent ) => {
		e.preventDefault();
		e.stopPropagation();
		setIsDragging( true );
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
			const backupFile = files.find( ( file ) => {
				return ACCEPTED_IMPORT_FILE_TYPES.some( ( ext ) =>
					file.name.toLowerCase().endsWith( ext )
				);
			} );

			if ( backupFile ) {
				handleFileSelection( backupFile );
			}
		},
		[ handleFileSelection ]
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
			onFileSelect();
			if ( fileInputRef.current ) {
				fileInputRef.current.value = '';
			}
		},
		[ onFileSelect ]
	);

	// Format the file types for display
	const supportedFormatsText = useMemo( () => {
		const formats = ACCEPTED_IMPORT_FILE_TYPES.map( ( ext ) =>
			ext.replace( '.', '' ).toUpperCase()
		);
		// Remove duplicates and format nicely
		const uniqueFormats = [ ...new Set( formats ) ];
		return uniqueFormats.join( ', ' );
	}, [] );

	// Format file size
	const formatFileSize = useCallback( ( bytes: number ) => {
		if ( bytes === 0 ) return '0 Bytes';
		const k = 1024;
		const sizes = [ 'Bytes', 'KB', 'MB', 'GB' ];
		const i = Math.floor( Math.log( bytes ) / Math.log( k ) );
		return Math.round( ( bytes / Math.pow( k, i ) ) * 100 ) / 100 + ' ' + sizes[ i ];
	}, [] );

	return (
		<VStack className="text-center w-full" alignment="top" spacing={ 6 }>
			<Heading className="text-4xl mb-10">{ __( 'Import from a backup' ) }</Heading>

			<div
				className={ cx(
					'w-full max-w-2xl h-80 mx-auto p-12 border-2 rounded-xl',
					'transition-colors cursor-pointer',
					isDragging
						? 'border-blue-500 bg-blue-50'
						: 'border-gray-300 hover:border-gray-400 hover:bg-gray-50'
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
							className="text-base font-medium text-gray-900 max-w-md truncate px-4"
							weight={ 400 }
							title={ selectedFile.name }
						>
							{ selectedFile.name }
						</Text>
						<HStack spacing={ 2 } alignment="center">
							<Text className="text-base text-gray-600">
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
					<VStack className="items-center justify-center h-full" spacing={ 4 }>
						<Icon icon={ download } size={ 24 } className="fill-gray-400" />
						<>
							<Heading
								className="text-base leading-4 font-normal text-center text-gray-700"
								weight="400"
							>
								{ isDragging
									? __( 'Drop your backup file here' )
									: __( 'Drag a file here, or click to select a file' ) }
							</Heading>
							<Text className="text-xs leading-4 font-normal text-center text-gray-700">
								{ sprintf(
									/* translators: %s: List of supported file formats */
									__( 'Supported formats: %s' ),
									supportedFormatsText
								) }
							</Text>
						</>
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
		</VStack>
	);
}
