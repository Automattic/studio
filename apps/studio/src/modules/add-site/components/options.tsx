import { ACCEPTED_ADD_SITE_FILE_TYPES } from '@studio/common/constants';
import { isSupportedBackupFilename } from '@studio/common/lib/backup-files';
import {
	__experimentalVStack as VStack,
	__experimentalHeading as Heading,
	__experimentalText as Text,
	Notice,
} from '@wordpress/components';
import { useI18n } from '@wordpress/react-i18n';
import { useCallback, useRef, useState } from 'react';
import offlineIcon from 'src/components/offline-icon';
import { Tooltip } from 'src/components/tooltip';
import { useOffline } from 'src/hooks/use-offline';
import { cx } from 'src/lib/cx';
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
				<Heading className="text-base transition-colors group-hover:text-frame-theme" weight="500">
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
	const fileRef = useRef< HTMLInputElement >( null );

	const handleFile = useCallback(
		( file: File | undefined ) => {
			if ( ! file ) {
				return;
			}
			if ( ! isSupportedBackupFilename( file.name, ACCEPTED_ADD_SITE_FILE_TYPES ) ) {
				setExtensionError( __( 'Unsupported file type.' ) );
				return;
			}
			setExtensionError( undefined );
			onValidated( file );
		},
		[ __, onValidated ]
	);

	const handleDrop = useCallback(
		( e: React.DragEvent ) => {
			e.preventDefault();
			setIsDragging( false );
			handleFile( e.dataTransfer.files[ 0 ] );
		},
		[ handleFile ]
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

	return (
		<div
			className={ cx(
				'group w-full border rounded-xl p-6 text-center',
				'bg-frame/50 backdrop-blur-md transition-colors cursor-pointer',
				isDragging
					? 'border-frame-theme bg-frame-theme/5'
					: 'border-frame-border hover:border-frame-theme'
			) }
			onDragOver={ ( e ) => {
				e.preventDefault();
				setIsDragging( true );
				setExtensionError( undefined );
			} }
			onDragLeave={ ( e ) => {
				e.preventDefault();
				setIsDragging( false );
			} }
			onDrop={ handleDrop }
			onClick={ () => {
				fileRef.current?.click();
			} }
		>
			<input
				ref={ fileRef }
				type="file"
				accept={ ACCEPTED_ADD_SITE_FILE_TYPES.join( ',' ) }
				onChange={ handleChange }
				className="hidden"
			/>
			<div className="flex flex-col items-center justify-center gap-4 min-h-[180px]">
				<DropBackupIllustration />
				<div className="flex flex-col gap-1">
					<Heading
						className="text-base transition-colors group-hover:text-frame-theme"
						weight="500"
					>
						{ __( 'Import from a backup' ) }
					</Heading>
					<Text className="text-[13px] !text-frame-text-secondary" weight="400">
						{ __( 'Drop a file or click to browse (.zip, .tar.gz, .wpress, .xml)' ) }
					</Text>
				</div>
			</div>
			{ extensionError && (
				<Notice status="error" isDismissible={ false } className="!mt-4 !mx-0 text-left">
					{ extensionError }
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

			<div className="flex gap-5 w-full max-w-[760px]">
				<OptionCard
					illustration={ <BuildNewSiteIllustration /> }
					title={ __( 'Build a new site' ) }
					description={ __(
						'Start from scratch or use a blueprint. Perfect for theme and plugin development.'
					) }
					onClick={ () => onOptionSelect( 'new' ) }
					testId="create-site-option-button"
				/>
				<Tooltip
					disabled={ ! isOffline }
					icon={ offlineIcon }
					text={ __( 'Connecting a site requires an internet connection.' ) }
					className="flex-1 flex"
				>
					<OptionCard
						illustration={ <ConnectSiteIllustration /> }
						title={ __( 'Connect a site' ) }
						description={ __(
							'Edit a WordPress.com or Pressable site locally, then push changes back'
						) }
						onClick={ () => onOptionSelect( 'connect' ) }
						disabled={ isOffline }
					/>
				</Tooltip>
				<ImportDropZone onValidated={ handleValidatedBackup } />
			</div>
		</VStack>
	);
}
