import { useState, useEffect, useCallback } from 'react';
import { getIpcApi } from 'src/lib/get-ipc-api';
import type { AvailableSkill, Skill, SkillInstallResult } from '../types';

interface UseSiteSkillsResult {
	skills: Skill[];
	isLoading: boolean;
	error: string | null;
	refresh: () => Promise< void >;
	removeSkill: ( skillName: string ) => Promise< void >;
}

export function useSiteSkills( siteId: string ): UseSiteSkillsResult {
	const [ skills, setSkills ] = useState< Skill[] >( [] );
	const [ isLoading, setIsLoading ] = useState( true );
	const [ error, setError ] = useState< string | null >( null );

	const loadSkills = useCallback( async () => {
		if ( ! siteId ) {
			setSkills( [] );
			setIsLoading( false );
			return;
		}

		setIsLoading( true );
		setError( null );

		try {
			const loadedSkills = await getIpcApi().getSiteSkills( siteId );
			setSkills( loadedSkills as Skill[] );
		} catch ( err ) {
			const errorMessage = err instanceof Error ? err.message : String( err );
			setError( errorMessage );
			setSkills( [] );
		} finally {
			setIsLoading( false );
		}
	}, [ siteId ] );

	useEffect( () => {
		void loadSkills();
	}, [ loadSkills ] );

	const removeSkillCallback = useCallback(
		async ( skillName: string ) => {
			try {
				await getIpcApi().removeSkill( siteId, skillName );
				await loadSkills();
			} catch ( err ) {
				const errorMessage = err instanceof Error ? err.message : String( err );
				throw new Error( errorMessage );
			}
		},
		[ siteId, loadSkills ]
	);

	return {
		skills,
		isLoading,
		error,
		refresh: loadSkills,
		removeSkill: removeSkillCallback,
	};
}

interface UseAvailableSkillsResult {
	availableSkills: AvailableSkill[];
	isLoading: boolean;
	error: string | null;
	refresh: () => Promise< void >;
}

export function useAvailableSkills( repo?: string ): UseAvailableSkillsResult {
	const [ availableSkills, setAvailableSkills ] = useState< AvailableSkill[] >( [] );
	const [ isLoading, setIsLoading ] = useState( false );
	const [ error, setError ] = useState< string | null >( null );

	const loadSkills = useCallback( async () => {
		setIsLoading( true );
		setError( null );

		try {
			const skills = await getIpcApi().listAvailableSkills( repo );
			setAvailableSkills( skills as AvailableSkill[] );
		} catch ( err ) {
			const errorMessage = err instanceof Error ? err.message : String( err );
			setError( errorMessage );
			setAvailableSkills( [] );
		} finally {
			setIsLoading( false );
		}
	}, [ repo ] );

	return {
		availableSkills,
		isLoading,
		error,
		refresh: loadSkills,
	};
}

interface UseInstallSkillResult {
	installSkill: ( skillPath: string, repo?: string ) => Promise< SkillInstallResult >;
	isInstalling: boolean;
	installError: string | null;
}

export function useInstallSkill( siteId: string, onSuccess?: () => void ): UseInstallSkillResult {
	const [ isInstalling, setIsInstalling ] = useState( false );
	const [ installError, setInstallError ] = useState< string | null >( null );

	const installSkill = useCallback(
		async ( skillPath: string, repo?: string ): Promise< SkillInstallResult > => {
			setIsInstalling( true );
			setInstallError( null );

			try {
				const result = await getIpcApi().installSkill(
					siteId,
					repo ?? 'WordPress/agent-skills',
					skillPath
				);

				if ( result.success ) {
					onSuccess?.();
				} else {
					setInstallError( ( result as SkillInstallResult ).error ?? 'Installation failed' );
				}

				return result as SkillInstallResult;
			} catch ( err ) {
				const errorMessage = err instanceof Error ? err.message : String( err );
				setInstallError( errorMessage );
				return { success: false, error: errorMessage };
			} finally {
				setIsInstalling( false );
			}
		},
		[ siteId, onSuccess ]
	);

	return { installSkill, isInstalling, installError };
}
