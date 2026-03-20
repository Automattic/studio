import { Icon, check } from '@wordpress/icons';
import { useI18n } from '@wordpress/react-i18n';
import { useCallback, useEffect, useState } from 'react';
import Button from 'src/components/button';
import { getIpcApi } from 'src/lib/get-ipc-api';
import { type SkillStatus } from 'src/modules/agent-instructions/lib/skills-constants';

export function SkillsTab() {
	const { __ } = useI18n();
	const [ statuses, setStatuses ] = useState< SkillStatus[] >( [] );
	const [ error, setError ] = useState< string | null >( null );
	const [ installingSkillId, setInstallingSkillId ] = useState< string | null >( null );
	const [ installingAll, setInstallingAll ] = useState( false );

	const refreshStatus = useCallback( async () => {
		try {
			const result = await getIpcApi().getWordPressSkillsStatusAllSites();
			setStatuses( result as SkillStatus[] );
			setError( null );
		} catch ( err ) {
			const errorMessage = err instanceof Error ? err.message : String( err );
			setError( errorMessage );
		}
	}, [] );

	useEffect( () => {
		void refreshStatus();
		const handleFocus = () => void refreshStatus();
		window.addEventListener( 'focus', handleFocus );
		return () => window.removeEventListener( 'focus', handleFocus );
	}, [ refreshStatus ] );

	const handleInstallSkill = useCallback(
		async ( skillId: string ) => {
			setInstallingSkillId( skillId );
			setError( null );
			try {
				await getIpcApi().installWordPressSkillsToAllSites( { skillId } );
				await refreshStatus();
			} catch ( err ) {
				const errorMessage = err instanceof Error ? err.message : String( err );
				setError( errorMessage );
			} finally {
				setInstallingSkillId( null );
			}
		},
		[ refreshStatus ]
	);

	const wordPressSkills = statuses.filter( ( s ) => s.id !== 'studio-cli' );
	const installedSkills = wordPressSkills.filter( ( s ) => s.installed );
	const availableSkills = wordPressSkills.filter( ( s ) => ! s.installed );

	const handleInstallAll = useCallback( async () => {
		setInstallingAll( true );
		setError( null );
		try {
			for ( const skill of availableSkills ) {
				await getIpcApi().installWordPressSkillsToAllSites( { skillId: skill.id } );
			}
			await refreshStatus();
		} catch ( err ) {
			const errorMessage = err instanceof Error ? err.message : String( err );
			setError( errorMessage );
		} finally {
			setInstallingAll( false );
		}
	}, [ availableSkills, refreshStatus ] );
	const isAnyInstalling = installingSkillId !== null || installingAll;

	return (
		<div className="flex flex-col gap-4 pb-2">
			<p className="text-xs text-gray-500">
				{ __(
					'WordPress development skills for AI agents, installed across all your local sites.'
				) }
			</p>

			{ error && (
				<div className="bg-red-50 border border-red-200 text-red-700 px-3 py-2 rounded text-sm">
					{ error }
				</div>
			) }

			{ installedSkills.length > 0 && (
				<div className="flex flex-col gap-2">
					<span className="text-[11px] font-semibold uppercase tracking-wide text-gray-400 px-1">
						{ __( 'Installed' ) }
					</span>
					<div className="border border-frame-border rounded-md overflow-hidden">
						{ installedSkills.map( ( skill ) => (
							<div
								key={ skill.id }
								className="flex items-center justify-between px-3 py-2.5 border-b border-frame-border last:border-b-0"
							>
								<div className="flex-1 min-w-0 pr-3">
									<div className="flex items-center gap-2">
										<span className="text-sm font-medium text-gray-900">{ skill.displayName }</span>
										<span className="inline-flex items-center gap-1 text-[11px] text-green-700 bg-green-50 px-2 py-0.5 rounded-full">
											<Icon icon={ check } size={ 12 } />
											{ __( 'Installed' ) }
										</span>
									</div>
									<div className="text-xs text-gray-500">{ skill.description }</div>
								</div>
							</div>
						) ) }
					</div>
				</div>
			) }

			{ availableSkills.length > 0 && (
				<div className="flex flex-col gap-2">
					<div className="flex items-center justify-between px-1">
						<span className="text-[11px] font-semibold uppercase tracking-wide text-gray-400">
							{ __( 'Available' ) }
						</span>
						<Button
							variant="link"
							onClick={ handleInstallAll }
							disabled={ isAnyInstalling }
							className="text-xs"
						>
							{ installingAll ? __( 'Installing...' ) : __( 'Install all' ) }
						</Button>
					</div>
					<div className="border border-frame-border rounded-md overflow-hidden">
						{ availableSkills.map( ( skill ) => {
							const isInstallingThis = installingSkillId === skill.id;
							return (
								<div
									key={ skill.id }
									className="flex items-center justify-between px-3 py-2.5 border-b border-frame-border last:border-b-0"
								>
									<div className="flex-1 min-w-0 pr-3">
										<div className="text-sm font-medium text-gray-900">{ skill.displayName }</div>
										<div className="text-xs text-gray-500">{ skill.description }</div>
									</div>
									<div className="flex-shrink-0">
										<Button
											variant="secondary"
											onClick={ () => handleInstallSkill( skill.id ) }
											disabled={ isAnyInstalling }
											className="text-xs py-1 px-2"
										>
											{ isInstallingThis ? __( 'Installing...' ) : __( 'Install' ) }
										</Button>
									</div>
								</div>
							);
						} ) }
					</div>
				</div>
			) }

			{ statuses.length === 0 && ! error && (
				<div className="text-sm text-gray-500 text-center py-4">{ __( 'Loading skills...' ) }</div>
			) }
		</div>
	);
}
