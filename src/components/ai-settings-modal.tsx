import { Spinner, TabPanel } from '@wordpress/components';
import { Icon, check } from '@wordpress/icons';
import { useI18n } from '@wordpress/react-i18n';
import { useCallback, useEffect, useMemo, useState } from 'react';
import Button from 'src/components/button';
import Modal from 'src/components/modal';
import { AgentIcon } from 'src/components/agent-selector/agent-icon';
import { ModelSelector } from 'src/components/model-selector';
import { cx } from 'src/lib/cx';
import { getIpcApi } from 'src/lib/get-ipc-api';
import { SkillsPanel } from 'src/modules/agent-skills';
import {
	DEFAULT_AGENT_INSTRUCTIONS,
	INSTRUCTION_FILE_TYPES,
	INSTRUCTION_FILES,
	type InstructionFileType,
} from 'src/modules/agent-instructions/constants';
import { agentChatSelectors, agentChatThunks } from 'src/stores/agent-chat-slice';
import { useAppDispatch, useRootSelector } from 'src/stores';
import type { AgentConfig } from 'src/modules/acp/types';
import { useAgentChat } from 'src/hooks/use-agent-chat';

interface AiSettingsModalProps {
	isOpen: boolean;
	onClose: () => void;
	siteId: string;
}

function getAgentStatusLabel( agent: AgentConfig, __: ( text: string ) => string ): string | null {
	if ( agent.provider === 'wpcom' ) {
		return __( 'Cloud' );
	}

	if ( agent.provider === 'anthropic-builtin' ) {
		return __( 'Built-in' );
	}

	if ( agent.status === 'unavailable' || agent.status === 'error' ) {
		return __( 'Not available' );
	}

	if ( agent.isInstalled === false ) {
		return agent.command === 'npx' ? __( 'Runs via npx' ) : __( 'Not installed' );
	}

	return __( 'Installed' );
}

function AgentSettingsPanel( { siteId }: { siteId: string } ) {
	const { __ } = useI18n();
	const dispatch = useAppDispatch();
	const availableAgents = useRootSelector( agentChatSelectors.selectAvailableAgents );
	const selectedAgentId = useRootSelector( agentChatSelectors.selectSelectedAgentId );
	const selectedAgent = useRootSelector( agentChatSelectors.selectSelectedAgent );
	const isLoadingAgents = useRootSelector( agentChatSelectors.selectIsLoadingAgents );

	// Get model info from the agent chat hook
	const { availableModels, currentModelId, setModel } = useAgentChat( { siteId } );

	useEffect( () => {
		if ( availableAgents.length === 0 ) {
			void dispatch( agentChatThunks.loadAvailableAgents() );
		}
	}, [ dispatch, availableAgents.length ] );

	const handleRefresh = useCallback( () => {
		void dispatch( agentChatThunks.loadAvailableAgents() );
	}, [ dispatch ] );

	const handleSelectAgent = useCallback(
		( agentId: string ) => {
			void dispatch( agentChatThunks.selectAgent( agentId ) );
		},
		[ dispatch ]
	);

	const groupedAgents = useMemo(
		() => [
			{ title: __( 'Chat' ), agents: availableAgents.filter( ( a ) => a.provider === 'wpcom' ) },
			{
				title: __( 'Built-in' ),
				agents: availableAgents.filter( ( a ) => a.provider === 'anthropic-builtin' ),
			},
			{ title: __( 'Agents' ), agents: availableAgents.filter( ( a ) => a.provider === 'acp' ) },
		],
		[ availableAgents, __ ]
	);

	const isAgentAvailable = ( agent: AgentConfig ) =>
		agent.status !== 'unavailable' && agent.status !== 'error';

	return (
		<div className="flex flex-col gap-4">
			<div className="flex items-center justify-between">
				<div>
					<h3 className="text-sm font-medium text-gray-900">{ __( 'Active agent' ) }</h3>
					<p className="text-xs text-gray-500 mt-0.5">
						{ __( 'Pick which agent handles AI conversations.' ) }
					</p>
				</div>
				<Button variant="secondary" onClick={ handleRefresh } className="text-sm">
					{ isLoadingAgents ? __( 'Refreshing...' ) : __( 'Refresh' ) }
				</Button>
			</div>

			{ /* Model selector - only show when selected agent supports models */ }
			{ availableModels && availableModels.length > 1 && currentModelId && (
				<div className="flex items-center justify-between p-3 bg-gray-50 border border-gray-200 rounded-md">
					<div>
						<div className="text-sm font-medium text-gray-900">{ __( 'Model' ) }</div>
						<div className="text-xs text-gray-500">
							{ selectedAgent?.name ?? __( 'Current agent' ) }
						</div>
					</div>
					<ModelSelector
						availableModels={ availableModels }
						currentModelId={ currentModelId }
						onModelChange={ setModel }
					/>
				</div>
			) }

			<div className="border border-gray-200 rounded-md overflow-hidden">
				{ groupedAgents.map( ( group ) => (
					<div key={ group.title }>
						{ group.agents.length > 0 && (
							<>
								<div className="px-3 py-2 text-[11px] font-medium text-gray-600 uppercase tracking-wide bg-gray-50 border-b border-gray-200">
									{ group.title }
								</div>
								{ group.agents.map( ( agent ) => {
									const statusLabel = getAgentStatusLabel( agent, __ );
									const isSelected = agent.id === selectedAgentId;
									const isAvailable = isAgentAvailable( agent );
									return (
										<button
											key={ agent.id }
											type="button"
											onClick={ () => isAvailable && handleSelectAgent( agent.id ) }
											disabled={ ! isAvailable }
											className={ cx(
												'w-full flex items-center justify-between px-3 py-2.5 border-b border-gray-200 last:border-b-0 text-left transition-colors',
												isAvailable
													? 'cursor-pointer hover:bg-gray-50'
													: 'cursor-not-allowed opacity-50',
												isSelected && 'bg-blue-50 hover:bg-blue-50'
											) }
										>
											<div className="flex items-center gap-2 min-w-0">
												<AgentIcon agentId={ agent.id } icon={ agent.icon } size={ 18 } />
												<div className="min-w-0">
													<div className="text-sm text-gray-900 truncate">{ agent.name }</div>
													<div className="text-xs text-gray-500 truncate">
														{ agent.description }
													</div>
												</div>
											</div>
											<div className="flex items-center gap-2">
												{ statusLabel && (
													<span className="text-[11px] text-gray-600 bg-gray-100 px-2 py-0.5 rounded-full">
														{ statusLabel }
													</span>
												) }
												{ isSelected && (
													<span className="text-a8c-blue-50 shrink-0">
														<Icon icon={ check } size={ 18 } />
													</span>
												) }
											</div>
										</button>
									);
								} ) }
							</>
						) }
					</div>
				) ) }

				{ availableAgents.length === 0 && ! isLoadingAgents && (
					<div className="px-3 py-4 text-sm text-gray-500 text-center">
						{ __( 'No agents detected.' ) }
					</div>
				) }

				{ isLoadingAgents && (
					<div className="flex items-center justify-center py-4">
						<Spinner />
						<span className="ml-2 text-sm text-gray-500">{ __( 'Scanning for agents...' ) }</span>
					</div>
				) }
			</div>
		</div>
	);
}

interface InstructionFileStatus {
	id: InstructionFileType;
	fileName: string;
	displayName: string;
	description: string;
	exists: boolean;
	path: string;
}

function AgentInstructionsPanel( { siteId }: { siteId: string } ) {
	const { __ } = useI18n();
	const [ statuses, setStatuses ] = useState< InstructionFileStatus[] >( [] );
	const [ error, setError ] = useState< string | null >( null );
	const [ isLoading, setIsLoading ] = useState( true );
	const [ installingFile, setInstallingFile ] = useState< InstructionFileType | 'all' | null >(
		null
	);

	const refreshStatus = useCallback( async () => {
		setIsLoading( true );
		try {
			const result = await getIpcApi().getAgentInstructionsStatus( siteId );
			setStatuses( result as InstructionFileStatus[] );
			setError( null );
		} catch ( err ) {
			const errorMessage = err instanceof Error ? err.message : String( err );
			setError( errorMessage );
		} finally {
			setIsLoading( false );
		}
	}, [ siteId ] );

	useEffect( () => {
		void refreshStatus();
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

	const handleInstallAll = useCallback(
		async ( overwrite: boolean ) => {
			setInstallingFile( 'all' );
			setError( null );
			try {
				await getIpcApi().installAllAgentInstructions( siteId, { overwrite } );
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

	const installedCount = statuses.filter( ( s ) => s.exists ).length;
	const allInstalled = installedCount === INSTRUCTION_FILE_TYPES.length;
	const hasOutdated = statuses.some( ( s ) => s.isOutdated );

	return (
		<div className="flex flex-col gap-4">
			<div className="flex items-center justify-between">
				<div>
					<h3 className="text-sm font-medium text-gray-900">{ __( 'Agent instructions' ) }</h3>
					<p className="text-xs text-gray-500 mt-0.5">
						{ __( 'Install instructions so agents know how to use Studio' ) }
					</p>
				</div>
				<Button
					variant="link"
					onClick={ () => handleInstallAll( allInstalled ) }
					disabled={ installingFile !== null }
					className="text-sm"
				>
					{ installingFile === 'all'
						? __( 'Installing...' )
						: hasOutdated
							? __( 'Update All' )
							: allInstalled
								? __( 'Reinstall All' )
								: __( 'Install All' ) }
				</Button>
			</div>

			{ error && (
				<div className="bg-red-50 border border-red-200 text-red-700 px-3 py-2 rounded text-sm">
					{ error }
				</div>
			) }

			{ /* File list */ }
			<div className="border border-gray-200 rounded-md overflow-hidden">
				{ isLoading ? (
					<div className="flex items-center justify-center py-4">
						<Spinner />
						<span className="ml-2 text-sm text-gray-500">{ __( 'Loading...' ) }</span>
					</div>
				) : (
					statuses.map( ( status ) => {
						const config = INSTRUCTION_FILES[ status.id ];
						const isInstalling = installingFile === status.id || installingFile === 'all';
						return (
							<div
								key={ status.id }
								className="flex items-center justify-between px-3 py-2.5 border-b border-gray-200 last:border-b-0"
							>
								<div className="flex-1 min-w-0 pr-3">
									<div className="flex items-center gap-2">
										<span className="text-sm font-medium text-gray-900">
											{ config.displayName }
										</span>
										{ status.exists && ! status.isOutdated && (
											<span className="inline-flex items-center gap-1 text-[11px] text-green-700 bg-green-50 px-2 py-0.5 rounded-full">
												<Icon icon={ check } size={ 12 } />
												{ __( 'Installed' ) }
											</span>
										) }
										{ status.exists && status.isOutdated && (
											<span className="inline-flex items-center gap-1 text-[11px] text-orange-700 bg-orange-50 px-2 py-0.5 rounded-full">
												{ __( 'Update Available' ) }
											</span>
										) }
									</div>
									<div className="text-xs text-gray-500">
										{ config.description }
										{ status.isOutdated && (
											<span className="block mt-1 text-orange-600">
												{ __( 'A newer version is available. Reinstall to get the latest commands.' ) }
											</span>
										) }
									</div>
								</div>
								<div className="flex items-center gap-2 flex-shrink-0">
									{ status.exists && (
										<Button
											variant="link"
											onClick={ () =>
												getIpcApi().openFileInIDE( config.fileName, siteId )
											}
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
											: status.exists && status.isOutdated
												? __( 'Update' )
												: status.exists
													? __( 'Reinstall' )
													: __( 'Install' ) }
									</Button>
								</div>
							</div>
						);
					} )
				) }
			</div>

			{ /* Template preview */ }
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

export function AiSettingsModal( { isOpen, onClose, siteId }: AiSettingsModalProps ) {
	const { __ } = useI18n();

	if ( ! isOpen ) {
		return null;
	}

	const tabs = [
		{ name: 'agent', title: __( 'Agent' ) },
		{ name: 'skills', title: __( 'Skills' ) },
		{ name: 'instructions', title: __( 'Instructions' ) },
	];

	return (
		<Modal
			title={ __( 'AI settings' ) }
			isDismissible
			onRequestClose={ onClose }
			size="medium"
			className="min-h-[350px] [&_[role='document']]:px-0 app-no-drag-region"
		>
			<TabPanel
				className="w-full"
				tabs={ tabs }
				orientation="horizontal"
				initialTabName="agent"
			>
				{ ( { name } ) => (
					<div className="mt-6 px-8 pb-4 flex gap-4 flex-col">
						{ name === 'agent' && <AgentSettingsPanel siteId={ siteId } /> }
						{ name === 'skills' && <SkillsPanel siteId={ siteId } /> }
						{ name === 'instructions' && <AgentInstructionsPanel siteId={ siteId } /> }
					</div>
				) }
			</TabPanel>
		</Modal>
	);
}
