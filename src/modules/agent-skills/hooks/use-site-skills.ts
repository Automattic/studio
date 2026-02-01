/**
 * React hook for loading and managing site skills.
 */

import { useState, useEffect, useCallback } from 'react';
import { getIpcApi } from 'src/lib/get-ipc-api';
import type { Skill, AvailableSkill, SkillInstallResult } from '../types';

interface UseSiteSkillsResult {
	/** List of installed skills */
	skills: Skill[];
	/** Whether skills are currently loading */
	isLoading: boolean;
	/** Error message if loading failed */
	error: string | null;
	/** Reload the skills list */
	refresh: () => Promise< void >;
	/** Remove a skill */
	removeSkill: ( skillName: string ) => Promise< void >;
}

/**
 * Hook for loading and managing skills for a specific site.
 *
 * @param siteId - The site ID to load skills for
 * @returns Object containing skills, loading state, and management functions
 */
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
			setSkills( loadedSkills );
		} catch ( err ) {
			const errorMessage = err instanceof Error ? err.message : String( err );
			console.error( 'Failed to load skills:', err );
			setError( errorMessage );
			setSkills( [] );
		} finally {
			setIsLoading( false );
		}
	}, [ siteId ] );

	useEffect( () => {
		void loadSkills();
	}, [ loadSkills ] );

	const removeSkill = useCallback(
		async ( skillName: string ) => {
			try {
				await getIpcApi().removeSkill( siteId, skillName );
				await loadSkills();
			} catch ( err ) {
				const errorMessage = err instanceof Error ? err.message : String( err );
				console.error( 'Failed to remove skill:', err );
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
		removeSkill,
	};
}

interface UseAvailableSkillsResult {
	/** List of available skills from the repository */
	availableSkills: AvailableSkill[];
	/** Whether skills are currently loading */
	isLoading: boolean;
	/** Error message if loading failed */
	error: string | null;
	/** Reload the available skills */
	refresh: () => Promise< void >;
}

/**
 * Hook for loading available skills from a GitHub repository.
 *
 * @param repo - Repository to load skills from (optional)
 * @returns Object containing available skills and loading state
 */
export function useAvailableSkills( repo?: string ): UseAvailableSkillsResult {
	const [ availableSkills, setAvailableSkills ] = useState< AvailableSkill[] >( [] );
	const [ isLoading, setIsLoading ] = useState( true );
	const [ error, setError ] = useState< string | null >( null );

	const loadSkills = useCallback( async () => {
		setIsLoading( true );
		setError( null );

		try {
			const skills = await getIpcApi().listAvailableSkills( repo );
			setAvailableSkills( skills );
		} catch ( err ) {
			const errorMessage = err instanceof Error ? err.message : String( err );
			console.error( 'Failed to load available skills:', err );
			setError( errorMessage );
			setAvailableSkills( [] );
		} finally {
			setIsLoading( false );
		}
	}, [ repo ] );

	useEffect( () => {
		void loadSkills();
	}, [ loadSkills ] );

	return {
		availableSkills,
		isLoading,
		error,
		refresh: loadSkills,
	};
}

interface UseInstallSkillResult {
	/** Install a skill from a repository */
	installSkill: ( skillPath: string, repo?: string ) => Promise< SkillInstallResult >;
	/** Whether an installation is in progress */
	isInstalling: boolean;
	/** Error from the last installation attempt */
	installError: string | null;
}

/**
 * Hook for installing skills from GitHub repositories.
 *
 * @param siteId - The site ID to install skills to
 * @param onSuccess - Callback when installation succeeds
 * @returns Object containing install function and status
 */
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
					setInstallError( result.error ?? 'Installation failed' );
				}

				return result;
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

	return {
		installSkill,
		isInstalling,
		installError,
	};
}
