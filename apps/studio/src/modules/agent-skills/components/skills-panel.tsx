import { Spinner } from '@wordpress/components';
import { Icon, check } from '@wordpress/icons';
import { useI18n } from '@wordpress/react-i18n';
import { useState, useCallback, useMemo } from 'react';
import Button from 'src/components/button';
import { cx } from 'src/lib/cx';
import { useAvailableSkills, useInstallSkill, useSiteSkills } from '../hooks/use-site-skills';

interface SkillRowProps {
	name: string;
	description: string;
	isInstalled: boolean;
	onInstall?: () => void;
	onRemove?: () => void;
	isInstalling?: boolean;
	isRemoving?: boolean;
}

function SkillRow( {
	name,
	description,
	isInstalled,
	onInstall,
	onRemove,
	isInstalling,
	isRemoving,
}: SkillRowProps ) {
	const { __ } = useI18n();
	const [ showConfirm, setShowConfirm ] = useState( false );

	const handleRemoveClick = useCallback( () => {
		if ( showConfirm ) {
			onRemove?.();
			setShowConfirm( false );
		} else {
			setShowConfirm( true );
		}
	}, [ showConfirm, onRemove ] );

	return (
		<div className="flex items-center justify-between px-3 py-2.5 border-b border-gray-200 last:border-b-0">
			<div className="flex-1 min-w-0 pr-3">
				<div className="text-sm text-gray-900 truncate">{ name }</div>
				<div className="text-xs text-gray-500 truncate">{ description }</div>
			</div>
			<div className="flex items-center gap-2 flex-shrink-0">
				{ isInstalled ? (
					<>
						<span className="inline-flex items-center gap-1 text-[11px] text-green-700 bg-green-50 px-2 py-0.5 rounded-full">
							<Icon icon={ check } size={ 12 } />
							{ __( 'Installed' ) }
						</span>
						{ showConfirm ? (
							<div className="flex items-center gap-1">
								<Button
									variant="link"
									onClick={ () => setShowConfirm( false ) }
									disabled={ isRemoving }
									className="text-xs"
								>
									{ __( 'Cancel' ) }
								</Button>
								<Button
									variant="link"
									onClick={ handleRemoveClick }
									disabled={ isRemoving }
									className="text-xs !text-a8c-red-50"
								>
									{ isRemoving ? __( 'Removing...' ) : __( 'Remove' ) }
								</Button>
							</div>
						) : (
							<Button
								variant="link"
								onClick={ handleRemoveClick }
								className="text-xs !text-gray-400 hover:!text-a8c-red-50"
							>
								{ __( 'Remove' ) }
							</Button>
						) }
					</>
				) : (
					<Button
						variant="secondary"
						onClick={ onInstall }
						disabled={ isInstalling }
						className="text-xs py-1 px-2"
					>
						{ isInstalling ? __( 'Installing...' ) : __( 'Install' ) }
					</Button>
				) }
			</div>
		</div>
	);
}

interface SkillsPanelProps {
	siteId: string;
	className?: string;
}

export function SkillsPanel( { siteId, className }: SkillsPanelProps ) {
	const { __ } = useI18n();

	const {
		skills: installedSkills,
		isLoading: isLoadingInstalled,
		error: installedError,
		refresh: refreshInstalled,
		removeSkill,
	} = useSiteSkills( siteId );

	const {
		availableSkills,
		isLoading: isLoadingAvailable,
		error: availableError,
		refresh: refreshAvailable,
	} = useAvailableSkills();

	const { installSkill, isInstalling, installError } = useInstallSkill( siteId, () => {
		void refreshInstalled();
	} );

	const [ removeError, setRemoveError ] = useState< string | null >( null );
	const [ removingSkill, setRemovingSkill ] = useState< string | null >( null );
	const [ installingPath, setInstallingPath ] = useState< string | null >( null );

	const installedNames = useMemo(
		() => new Set( installedSkills.map( ( s ) => s.name ) ),
		[ installedSkills ]
	);

	const uninstalledSkills = useMemo(
		() => availableSkills.filter( ( s ) => ! installedNames.has( s.name ) ),
		[ availableSkills, installedNames ]
	);

	const handleInstall = useCallback(
		async ( skillPath: string ) => {
			setInstallingPath( skillPath );
			try {
				await installSkill( skillPath );
			} finally {
				setInstallingPath( null );
			}
		},
		[ installSkill ]
	);

	const handleRemove = useCallback(
		async ( skillName: string ) => {
			setRemoveError( null );
			setRemovingSkill( skillName );
			try {
				await removeSkill( skillName );
			} catch ( err ) {
				setRemoveError( err instanceof Error ? err.message : String( err ) );
			} finally {
				setRemovingSkill( null );
			}
		},
		[ removeSkill ]
	);

	const error = installedError || availableError || installError || removeError;

	return (
		<div className={ cx( 'flex flex-col gap-4', className ) }>
			<div>
				<h3 className="text-sm font-medium text-gray-900">{ __( 'Agent Skills' ) }</h3>
				<p className="text-xs text-gray-500 mt-0.5">
					{ __( 'Enhance the AI assistant with specialized capabilities' ) }
				</p>
			</div>

			{ error && (
				<div className="bg-red-50 border border-red-200 text-red-700 px-3 py-2 rounded text-sm">
					{ error }
				</div>
			) }

			<div className="border border-gray-200 rounded-md overflow-hidden">
				<div className="px-3 py-2 text-[11px] font-medium text-gray-600 uppercase tracking-wide bg-gray-50 border-b border-gray-200">
					{ __( 'Installed' ) }
					{ installedSkills.length > 0 && (
						<span className="ml-1 text-gray-400">({ installedSkills.length })</span>
					) }
				</div>

				{ isLoadingInstalled ? (
					<div className="flex items-center justify-center py-4">
						<Spinner />
						<span className="ml-2 text-sm text-gray-500">{ __( 'Loading...' ) }</span>
					</div>
				) : installedSkills.length === 0 ? (
					<div className="px-3 py-4 text-sm text-gray-500 text-center">
						{ __( 'No skills installed yet' ) }
					</div>
				) : (
					installedSkills.map( ( skill ) => (
						<SkillRow
							key={ skill.name }
							name={ skill.name }
							description={ skill.description }
							isInstalled={ true }
							onRemove={ () => handleRemove( skill.name ) }
							isRemoving={ removingSkill === skill.name }
						/>
					) )
				) }

				<div className="px-3 py-2 text-[11px] font-medium text-gray-600 uppercase tracking-wide bg-gray-50 border-b border-gray-200 border-t flex items-center justify-between">
					<div>
						{ __( 'Available' ) }
						{ uninstalledSkills.length > 0 && (
							<span className="ml-1 text-gray-400">({ uninstalledSkills.length })</span>
						) }
					</div>
					{ uninstalledSkills.length > 0 && (
						<Button
							variant="link"
							onClick={ async () => {
								for ( const skill of uninstalledSkills ) {
									await handleInstall( skill.path );
								}
							} }
							disabled={ isInstalling }
							className="text-[11px] !py-0 !px-0 normal-case !font-medium"
						>
							{ isInstalling ? __( 'Installing...' ) : __( 'Install All' ) }
						</Button>
					) }
				</div>

				{ isLoadingAvailable ? (
					<div className="flex items-center justify-center py-4">
						<Spinner />
						<span className="ml-2 text-sm text-gray-500">{ __( 'Loading...' ) }</span>
					</div>
				) : availableError ? (
					<div className="px-3 py-4 text-sm text-gray-500 text-center">
						{ __( 'Could not load available skills' ) }
					</div>
				) : uninstalledSkills.length === 0 ? (
					<div className="px-3 py-4 text-sm text-gray-500 text-center">
						{ __( 'All available skills are installed' ) }
					</div>
				) : (
					uninstalledSkills.map( ( skill ) => (
						<SkillRow
							key={ skill.path }
							name={ skill.name }
							description={ skill.description }
							isInstalled={ false }
							onInstall={ () => handleInstall( skill.path ) }
							isInstalling={ isInstalling && installingPath === skill.path }
						/>
					) )
				) }
			</div>

			<p className="text-xs text-gray-500">
				{ __( 'Skills from ' ) }
				<a
					href="https://github.com/WordPress/agent-skills"
					target="_blank"
					rel="noopener noreferrer"
					className="text-blue-600 hover:underline"
				>
					WordPress/agent-skills
				</a>
			</p>
		</div>
	);
}
