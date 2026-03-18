import { TabPanel } from '@wordpress/components';
import { Icon, check } from '@wordpress/icons';
import { useI18n } from '@wordpress/react-i18n';
import { useCallback, useEffect, useState } from 'react';
import Button from 'src/components/button';
import Modal from 'src/components/modal';
import { cx } from 'src/lib/cx';
import { getIpcApi } from 'src/lib/get-ipc-api';
import {
	DEFAULT_AGENT_INSTRUCTIONS,
	INSTRUCTION_FILES,
	type InstructionFileType,
} from 'src/modules/agent-instructions/constants';
import { type InstructionFileStatus } from 'src/modules/agent-instructions/lib/instructions';
import {
	BUNDLED_SKILLS,
	type SkillStatus,
} from 'src/modules/agent-instructions/lib/skills-constants';

interface AiSettingsModalProps {
	isOpen: boolean;
	onClose: () => void;
	siteId: string;
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

	return (
		<div className="flex flex-col gap-4">
			<div className="flex items-center justify-between">
				<div>
					<h3 className="text-sm font-medium text-gray-900">{ __( 'Agent instructions' ) }</h3>
					<p className="text-xs text-gray-500 mt-0.5">
						{ __( 'Install instructions so agents know how to use Studio' ) }
					</p>
				</div>
				{ ! allInstalled && (
					<Button
						variant="link"
						onClick={ () => handleInstallFile( 'agents', false ) }
						disabled={ installingFile !== null }
						className="text-sm"
					>
						{ installingFile !== null ? __( 'Installing...' ) : __( 'Install All' ) }
					</Button>
				) }
			</div>

			{ error && (
				<div className="bg-red-50 border border-red-200 text-red-700 px-3 py-2 rounded text-sm">
					{ error }
				</div>
			) }

			<div className="border border-gray-200 rounded-md overflow-hidden">
				{ statuses.map( ( status ) => {
					const config = INSTRUCTION_FILES[ status.id ];
					const isInstalling = installingFile === status.id;
					return (
						<div
							key={ status.id }
							className="flex items-center justify-between px-3 py-2.5 border-b border-gray-200 last:border-b-0"
						>
							<div className="flex-1 min-w-0 pr-3">
								<div className="flex items-center gap-2">
									<span className="text-sm font-medium text-gray-900">{ config.displayName }</span>
									{ status.exists && ! status.isCustomized && (
										<span className="inline-flex items-center gap-1 text-[11px] text-green-700 bg-green-50 px-2 py-0.5 rounded-full">
											<Icon icon={ check } size={ 12 } />
											{ __( 'Installed' ) }
										</span>
									) }
									{ status.exists && status.isCustomized && (
										<span className="inline-flex items-center gap-1 text-[11px] text-blue-700 bg-blue-50 px-2 py-0.5 rounded-full">
											{ __( 'Custom' ) }
										</span>
									) }
								</div>
								<div className="text-xs text-gray-500">
									{ status.isCustomized
										? __(
												'You are using a custom version of AGENTS.md. You can use the "Reinstall" option to use the newest Studio version. Your customizations will be overwritten.'
										  )
										: __( config.description ) }
								</div>
							</div>
							<div className={ 'flex items-center gap-2 flex-shrink-0' }>
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

			<details className="group">
				<summary className="cursor-pointer text-xs text-gray-500 hover:text-gray-700">
					{ __( 'View template content' ) }
				</summary>
				<div className="mt-2 border border-gray-200 rounded-md bg-gray-50 p-3 max-h-48 overflow-y-auto">
					<pre className="text-xs text-gray-700 whitespace-pre-wrap font-mono">
						{ DEFAULT_AGENT_INSTRUCTIONS }
					</pre>
				</div>
			</details>
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
					<h3 className="text-sm font-medium text-gray-900">{ __( 'WordPress skills' ) }</h3>
					<p className="text-xs text-gray-500 mt-0.5">
						{ __( 'WordPress development skills for AI agents' ) }
					</p>
				</div>
			</div>

			{ error && (
				<div className="bg-red-50 border border-red-200 text-red-700 px-3 py-2 rounded text-sm">
					{ error }
				</div>
			) }

			<div className="border border-gray-200 rounded-md overflow-hidden">
				<div className="flex items-center justify-between px-3 py-2.5">
					<div className="flex-1 min-w-0 pr-3">
						<div className="flex items-center gap-2">
							<span className="text-sm font-medium text-gray-900">
								{ __( 'WordPress Skills' ) }
							</span>
							{ allInstalled && (
								<span className="inline-flex items-center gap-1 text-[11px] text-green-700 bg-green-50 px-2 py-0.5 rounded-full">
									<Icon icon={ check } size={ 12 } />
									{ __( 'Installed' ) }
								</span>
							) }
							{ ! allInstalled && installedCount > 0 && (
								<span className="inline-flex items-center gap-1 text-[11px] text-orange-700 bg-orange-50 px-2 py-0.5 rounded-full">
									{ `${ installedCount }/${ BUNDLED_SKILLS.length }` }
								</span>
							) }
						</div>
						<div className="text-xs text-gray-500">
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

	const tabs = [
		{ name: 'skills', title: __( 'Skills' ) },
		{ name: 'instructions', title: __( 'Instructions' ) },
	];

	return (
		<Modal
			title={ __( 'AI settings' ) }
			isDismissible
			onRequestClose={ onClose }
			size="medium"
			className={ cx( 'min-h-[350px] app-no-drag-region', '[&_[role="document"]]:px-0' ) }
		>
		<TabPanel className="w-full" tabs={ tabs } orientation="horizontal">
			{ ( { name } ) => (
				<div className="mt-6 px-8 pb-4 flex flex-col gap-4">
					{ name === 'skills' && <WordPressSkillsPanel siteId={ siteId } /> }
					{ name === 'instructions' && <AgentInstructionsPanel siteId={ siteId } /> }
				</div>
			) }
		</TabPanel>
		</Modal>
	);
}
