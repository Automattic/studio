import { ACCEPTED_IMPORT_FILE_TYPES } from '@studio/common/constants';
import {
	__experimentalVStack as VStack,
	__experimentalHeading as Heading,
	__experimentalText as Text,
	Notice,
	Spinner,
} from '@wordpress/components';
import { useI18n } from '@wordpress/react-i18n';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useOffline } from 'src/hooks/use-offline';
import { cx } from 'src/lib/cx';
import { useBackupPreflight } from '../hooks/use-backup-preflight';
import {
	BuildNewSiteIllustration,
	ConnectSiteIllustration,
	DropBackupIllustration,
} from './illustrations';

export type AddSiteFlowType = 'new' | 'connect' | 'blueprintDeeplink' | 'backup' | 'pullRemote';

interface AddSiteOptionsProps {
	onOptionSelect: ( option: AddSiteFlowType ) => void;
	onBackupFileSelect?: ( file: File ) => void;
}

function OptionCard( {
	illustration,
	title,
	description,
	onClick,
	disabled = false,
	testId,
}: {
	illustration: React.ReactNode;
	title: string;
	description: string;
	onClick: () => void;
	disabled?: boolean;
	testId?: string;
} ) {
	return (
		<button
			className={ cx(
				'group flex-1 flex flex-col items-center gap-4 p-6 border border-frame-border rounded-xl text-center',
				'bg-frame/50 backdrop-blur-md transition-colors',
				'hover:border-frame-theme',
				'disabled:opacity-50 disabled:cursor-not-allowed'
			) }
			onClick={ onClick }
			disabled={ disabled }
			data-testid={ testId }
		>
			<div>{ illustration }</div>
			<div className="flex flex-col gap-1">
				<Heading
					className="text-base transition-colors group-hover:text-frame-theme"
					weight="500"
				>
					{ title }
				</Heading>
				<Text className="text-[13px] !text-frame-text-secondary" weight="400">
					{ description }
				</Text>
			</div>
		</button>
	);
}

function ImportDropZone( { onValidated }: { onValidated: ( file: File ) => void } ) {
	const { __ } = useI18n();
	const [ isDragging, setIsDragging ] = useState( false );
	const [ extensionError, setExtensionError ] = useState< string >();
	const [ candidateFile, setCandidateFile ] = useState< File | null >( null );
	const fileRef = useRef< HTMLInputElement >( null );

	const preflight = useBackupPreflight( candidateFile );
	const checking = preflight.status === 'checking';

	useEffect( () => {
		if ( preflight.status === 'valid' && candidateFile ) {
			onValidated( candidateFile );
		}
	}, [ preflight.status, candidateFile, onValidated ] );

	const handleFile = useCallback(
		( file: File | undefined ) => {
			if ( ! file ) {
				return;
			}
			const hasValidExtension = ACCEPTED_IMPORT_FILE_TYPES.some( ( ext ) =>
				file.name.toLowerCase().endsWith( ext )
			);
			if ( ! hasValidExtension ) {
				setExtensionError( __( 'Unsupported file type.' ) );
				setCandidateFile( null );
				return;
			}
			setExtensionError( undefined );
			setCandidateFile( file );
		},
		[ __ ]
	);

	const handleDrop = useCallback(
		( e: React.DragEvent ) => {
			e.preventDefault();
			setIsDragging( false );
			if ( checking ) {
				return;
			}
			handleFile( e.dataTransfer.files[ 0 ] );
		},
		[ checking, handleFile ]
	);

	const handleChange = useCallback(
		( e: React.ChangeEvent< HTMLInputElement > ) => {
			handleFile( e.target.files?.[ 0 ] );
			if ( fileRef.current ) {
				fileRef.current.value = '';
			}
		},
		[ handleFile ]
	);

	const preflightError = preflight.status === 'invalid' ? preflight.reason : undefined;
	const errorMessage = extensionError || preflightError;
	const errorFileName = preflightError ? candidateFile?.name : undefined;

	return (
		<div
			className={ cx(
				'group w-full border border-dashed rounded-xl p-6 text-center',
				'bg-frame/50 backdrop-blur-md transition-colors',
				checking ? 'cursor-progress' : 'cursor-pointer',
				isDragging
					? 'border-frame-theme bg-frame-theme/5'
					: 'border-frame-border hover:border-frame-theme'
			) }
			onDragOver={ ( e ) => {
				e.preventDefault();
				if ( checking ) {
					return;
				}
				setIsDragging( true );
				setExtensionError( undefined );
			} }
			onDragLeave={ ( e ) => {
				e.preventDefault();
				setIsDragging( false );
			} }
			onDrop={ handleDrop }
			onClick={ () => {
				if ( ! checking ) {
					fileRef.current?.click();
				}
			} }
			aria-busy={ checking || undefined }
		>
			<input
				ref={ fileRef }
				type="file"
				accept={ ACCEPTED_IMPORT_FILE_TYPES.join( ',' ) }
				onChange={ handleChange }
				className="hidden"
				disabled={ checking }
			/>
			<div className="flex flex-col items-center justify-center gap-4 min-h-[180px]">
				{ checking ? (
					<>
						<Spinner style={ { margin: 0, width: 20, height: 20 } } />
						<Heading className="text-base" weight="500">
							{ __( 'Verifying backup…' ) }
						</Heading>
					</>
				) : (
					<>
						<DropBackupIllustration />
						<div className="flex flex-col gap-1">
							<Heading
								className="text-base transition-colors group-hover:text-frame-theme"
								weight="500"
							>
								{ __( 'Import from a backup' ) }
							</Heading>
							<Text className="text-[13px] !text-frame-text-secondary" weight="400">
								{ __( 'Drop a file or click to browse (.zip, .tar.gz, .sql, .wpress)' ) }
							</Text>
						</div>
					</>
				) }
			</div>
			{ errorMessage && (
				<Notice status="error" isDismissible={ false } className="!mt-4 !mx-0 text-left">
					{ errorFileName && (
						<>
							<strong>{ errorFileName }</strong>
							<br />
						</>
					) }
					{ errorMessage }
				</Notice>
			) }
		</div>
	);
}

export default function AddSiteOptions( {
	onOptionSelect,
	onBackupFileSelect,
}: AddSiteOptionsProps ) {
	const { __ } = useI18n();
	const isOffline = useOffline();

	const handleValidatedBackup = useCallback(
		( file: File ) => {
			onBackupFileSelect?.( file );
			onOptionSelect( 'backup' );
		},
		[ onBackupFileSelect, onOptionSelect ]
	);

	return (
		<VStack className="text-center w-full" alignment="top" spacing={ 0 }>
			<Heading className="text-center text-[32px] text-frame-text mb-2" weight={ 500 }>
				{ __( 'Add a site' ) }
			</Heading>
			<Text className="text-center text-[15px] font-light text-frame-text-secondary block mb-6">
				{ __( 'Start fresh or bring an existing site into your Studio.' ) }
			</Text>

			<div className="flex gap-3 w-full max-w-[540px]">
				<OptionCard
					illustration={ <BuildNewSiteIllustration /> }
					title={ __( 'Build a new site' ) }
					description={ __(
						'Start from scratch or use a blueprint. Perfect for theme and plugin development.'
					) }
					onClick={ () => onOptionSelect( 'new' ) }
					testId="create-site-option-button"
				/>
				<OptionCard
					illustration={ <ConnectSiteIllustration /> }
					title={ __( 'Connect a site' ) }
					description={ __(
						'Edit a WordPress.com or Pressable site locally, then push changes back'
					) }
					onClick={ () => onOptionSelect( 'connect' ) }
					disabled={ isOffline }
				/>
			</div>

			<div className="w-full max-w-[540px] mt-3">
				<ImportDropZone onValidated={ handleValidatedBackup } />
			</div>
		</VStack>
	);
}
