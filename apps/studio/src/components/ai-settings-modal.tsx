import { SelectControl } from '@wordpress/components';
import { Icon, check } from '@wordpress/icons';
import { useI18n } from '@wordpress/react-i18n';
import { useCallback, useEffect, useState } from 'react';
import Button from 'src/components/button';
import Modal from 'src/components/modal';
import { getIpcApi } from 'src/lib/get-ipc-api';
import {
	INSTRUCTION_FILES,
	type InstructionFileType,
} from 'src/modules/agent-instructions/constants';
import { type InstructionFileStatus } from 'src/modules/agent-instructions/lib/instructions';
import {
	BUNDLED_SKILLS,
	type SkillStatus,
} from 'src/modules/agent-instructions/lib/skills-constants';
import { type AiEngine } from 'src/modules/studio-code/studio-code-types';

interface AiSettingsModalProps {
	isOpen: boolean;
	onClose: () => void;
	siteId: string;
}

function AiEnginePanel() {
	const { __ } = useI18n();
	const [ engine, setEngine ] = useState< AiEngine >( 'wpcom-assistant' );

	useEffect( () => {
		void getIpcApi()
			.getAiEngine()
			.then( ( savedEngine ) => {
				setEngine( savedEngine );
			} );
	}, [] );

	const handleChange = ( value: string ) => {
		const newEngine = value as AiEngine;
		setEngine( newEngine );
		void getIpcApi().saveAiEngine( newEngine );
	};

	return (
		<div className="flex flex-col gap-4">
			<div>
				<h3 className="text-sm font-medium text-frame-text">{ __( 'AI engine' ) }</h3>
				<p className="text-xs text-frame-text-secondary mt-0.5">
					{ __( 'Choose which AI engine powers the assistant' ) }
				</p>
			</div>
			<SelectControl
				value={ engine }
				options={ [
					{
						label: __( 'Studio Assistant (WordPress.com)' ),
						value: 'wpcom-assistant',
					},
					{
						label: __( 'Studio Code (Local Agent)' ),
						value: 'studio-code',
					},
				] }
				onChange={ handleChange }
				__nextHasNoMarginBottom
			/>
			<p className="text-xs text-frame-text-secondary -mt-2">
				{ engine === 'studio-code'
					? __(
							'Studio Code runs a local AI agent using your own API key. It can read and edit files in your site directory.'
					  )
					: __(
							'Studio Assistant uses WordPress.com to answer questions about WordPress development.'
					  ) }
			</p>
		</div>
	);
}

function AgentInstructionsPanel( { siteId }: { siteId: string } ) {
	const { __ } = useI18n();
	const [ statuses, setStatuses ] = useState< InstructionFileStatus[] >( [] );
	const [ error, setError ] = useState< string | null >( null );
	const [ installingFile, setInstallingFile ] = useState< InstructionFileType | null >( null );

	const refreshStatus = useCallback( async () => {
		try {
			const result = await getIpcApi().getAgentInstructionsStatus( siteId );
			setStatuses( result as InstructionFileStatus[] );
			setError( null );
		} catch ( err ) {
			const errorMessage = err instanceof Error ? err.message : String( err );
			setError( errorMessage );
		}
	}, [ siteId ] );

	useEffect( () => {
		void refreshStatus();
		const handleFocus = () => void refreshStatus();
		window.addEventListener( 'focus', handleFocus );
		return () => window.removeEventListener( 'focus', handleFocus );
	}, [ refreshStatus ] );

	const handleInstallFile = useCallback(
		async ( fileType: InstructionFileType, overwrite: boolean ) => {
			setInstallingFile( fileType );
			setError( null );
			try {
				await getIpcApi().installAgentInstructions( siteId, { overwrite, fileType } );
				await refreshStatus();
			} catch ( err ) {
				const errorMessage = err instanceof Error ? err.message : String( err );
				setError( errorMessage );
			} finally {
				setInstallingFile( null );
			}
		},
		[ siteId, refreshStatus ]
	);

	const allInstalled = statuses.length > 0 && statuses.every( ( s ) => s.exists );

	const handleInstallAll = useCallback( async () => {
		setError( null );
		for ( const status of statuses ) {
			if ( ! status.exists ) {
				await handleInstallFile( status.id, false );
			}
		}
	}, [ statuses, handleInstallFile ] );

	return (
		<div className="flex flex-col gap-4">
			<div className="flex items-center justify-between">
				<div>
					<h3 className="text-sm font-medium text-frame-text">{ __( 'Agent instructions' ) }</h3>
					<p className="text-xs text-frame-text-secondary mt-0.5">
						{ __( 'Install instructions so agents know how to use Studio' ) }
					</p>
				</div>
				{ ! allInstalled && (
					<Button
						variant="link"
						onClick={ handleInstallAll }
						disabled={ installingFile !== null }
						className="text-sm"
					>
						{ installingFile !== null ? __( 'Installing...' ) : __( 'Install All' ) }
					</Button>
				) }
			</div>

			{ error && (
				<div className="bg-frame-surface border border-frame-error/30 text-frame-error px-3 py-2 rounded text-sm">
					{ error }
				</div>
			) }

			<div className="border border-frame-border rounded-md overflow-hidden">
				{ statuses.map( ( status ) => {
					const config = INSTRUCTION_FILES[ status.id ];
					const isInstalling = installingFile === status.id;
					return (
						<div
							key={ status.id }
							className="flex items-center justify-between px-3 py-2.5 border-b border-frame-border last:border-b-0"
						>
							<div className="flex-1 min-w-0 pr-3">
								<div className="flex items-center gap-2">
									<span className="text-sm font-medium text-frame-text">
										{ config.displayName }
									</span>
									{ status.exists && (
										<span className="inline-flex items-center gap-1 text-[11px] text-green-900 bg-green-50 dark:!text-green-300 dark:bg-green-950 px-2 py-0.5 rounded-full">
											<Icon className="dark:fill-green-300" icon={ check } size={ 12 } />
											{ __( 'Installed' ) }
										</span>
									) }
								</div>
								<div className="text-xs text-frame-text-secondary">
									{ __( config.description ) }
								</div>
							</div>
							<div className="flex items-center gap-2 flex-shrink-0">
								{ status.exists && (
									<Button
										variant="link"
										onClick={ () => getIpcApi().openFileInIDE( config.fileName, siteId ) }
										className="text-xs"
									>
										{ __( 'Open' ) }
									</Button>
								) }
								<Button
									variant="secondary"
									onClick={ () => handleInstallFile( status.id, status.exists ) }
									disabled={ isInstalling }
									className="text-xs py-1 px-2"
								>
									{ isInstalling
										? __( 'Installing...' )
										: status.exists
										? __( 'Reinstall' )
										: __( 'Install' ) }
								</Button>
							</div>
						</div>
					);
				} ) }
			</div>
		</div>
	);
}

function WordPressSkillsPanel( { siteId }: { siteId: string } ) {
	const { __ } = useI18n();
	const [ statuses, setStatuses ] = useState< SkillStatus[] >( [] );
	const [ error, setError ] = useState< string | null >( null );
	const [ installing, setInstalling ] = useState( false );

	const refreshStatus = useCallback( async () => {
		try {
			const result = await getIpcApi().getWordPressSkillsStatus( siteId );
			setStatuses( result as SkillStatus[] );
			setError( null );
		} catch ( err ) {
			const errorMessage = err instanceof Error ? err.message : String( err );
			setError( errorMessage );
		}
	}, [ siteId ] );

	useEffect( () => {
		void refreshStatus();
		const handleFocus = () => void refreshStatus();
		window.addEventListener( 'focus', handleFocus );
		return () => window.removeEventListener( 'focus', handleFocus );
	}, [ refreshStatus ] );

	const handleInstall = useCallback(
		async ( overwrite: boolean = false ) => {
			setInstalling( true );
			setError( null );
			try {
				await getIpcApi().installWordPressSkills( siteId, { overwrite } );
				await refreshStatus();
			} catch ( err ) {
				const errorMessage = err instanceof Error ? err.message : String( err );
				setError( errorMessage );
			} finally {
				setInstalling( false );
			}
		},
		[ siteId, refreshStatus ]
	);

	const allInstalled = statuses.length > 0 && statuses.every( ( s ) => s.installed );
	const installedCount = statuses.filter( ( s ) => s.installed ).length;

	return (
		<div className="flex flex-col gap-4">
			<div className="flex items-center justify-between">
				<div>
					<h3 className="text-sm font-medium text-frame-text">{ __( 'WordPress skills' ) }</h3>
					<p className="text-xs text-frame-text-secondary mt-0.5">
						{ __( 'WordPress development skills for AI agents' ) }
					</p>
				</div>
			</div>

			{ error && (
				<div className="bg-frame-surface border border-frame-error/30 text-frame-error px-3 py-2 rounded text-sm">
					{ error }
				</div>
			) }

			<div className="border border-frame-border rounded-md overflow-hidden">
				<div className="flex items-center justify-between px-3 py-2.5">
					<div className="flex-1 min-w-0 pr-3">
						<div className="flex items-center gap-2">
							<span className="text-sm font-medium text-frame-text">
								{ __( 'WordPress Skills' ) }
							</span>
							{ allInstalled && (
								<span className="inline-flex items-center gap-1 text-[11px] text-[#1a6928] bg-[#ceead6] dark:text-[#6ee7a0] dark:bg-[#1a3a24] px-2 py-0.5 rounded-full">
									<Icon icon={ check } size={ 12 } />
									{ __( 'Installed' ) }
								</span>
							) }
							{ ! allInstalled && installedCount > 0 && (
								<span className="inline-flex items-center gap-1 text-[11px] text-frame-text-secondary bg-frame-surface px-2 py-0.5 rounded-full">
									{ `${ installedCount }/${ BUNDLED_SKILLS.length }` }
								</span>
							) }
						</div>
						<div className="text-xs text-frame-text-secondary">
							{ __( 'Plugins, blocks, themes, REST API, and WP-CLI skills' ) }
						</div>
					</div>
					<div className="flex items-center gap-2 flex-shrink-0">
						<Button
							variant="secondary"
							onClick={ () => handleInstall( allInstalled ) }
							disabled={ installing }
							className="text-xs py-1 px-2"
						>
							{ installing
								? __( 'Installing...' )
								: allInstalled
								? __( 'Reinstall' )
								: __( 'Install' ) }
						</Button>
					</div>
				</div>
			</div>
		</div>
	);
}

export function AiSettingsModal( { isOpen, onClose, siteId }: AiSettingsModalProps ) {
	const { __ } = useI18n();

	if ( ! isOpen ) {
		return null;
	}

	return (
		<Modal
			title={ __( 'AI settings' ) }
			isDismissible
			onRequestClose={ onClose }
			size="medium"
			className="min-h-[350px] app-no-drag-region"
		>
			<div className="px-2 pb-4 flex gap-6 flex-col">
				<AiEnginePanel />
				<AgentInstructionsPanel siteId={ siteId } />
				<WordPressSkillsPanel siteId={ siteId } />
			</div>
		</Modal>
	);
}
