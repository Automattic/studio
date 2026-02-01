/**
 * InstallSkillModal - Modal for browsing and installing skills from GitHub.
 */

import { Spinner } from '@wordpress/components';
import { useI18n } from '@wordpress/react-i18n';
import { useMemo } from 'react';
import Button from 'src/components/button';
import Modal from 'src/components/modal';
import { useAvailableSkills, useInstallSkill } from '../hooks/use-site-skills';
import { AvailableSkillCard } from './skill-card';
import type { Skill } from '../types';

interface InstallSkillModalProps {
	/** Whether the modal is open */
	isOpen: boolean;
	/** Callback when the modal is closed */
	onClose: () => void;
	/** The site ID to install skills to */
	siteId: string;
	/** List of already installed skills */
	installedSkills: Skill[];
	/** Callback when a skill is successfully installed */
	onInstallSuccess: () => void;
}

export function InstallSkillModal( {
	isOpen,
	onClose,
	siteId,
	installedSkills,
	onInstallSuccess,
}: InstallSkillModalProps ) {
	const { __ } = useI18n();
	const { availableSkills, isLoading, error, refresh } = useAvailableSkills();
	const { installSkill, isInstalling, installError } = useInstallSkill( siteId, () => {
		onInstallSuccess();
	} );

	// Set of installed skill names for quick lookup
	const installedNames = useMemo(
		() => new Set( installedSkills.map( ( s ) => s.name ) ),
		[ installedSkills ]
	);

	const handleInstall = async ( skillPath: string ) => {
		const result = await installSkill( skillPath );
		if ( result.success ) {
			// Keep modal open so user can install more skills
		}
	};

	if ( ! isOpen ) {
		return null;
	}

	return (
		<Modal
			title={ __( 'Browse Skills' ) }
			onRequestClose={ onClose }
			className="w-[600px] max-h-[80vh]"
		>
			<div className="flex flex-col gap-4 p-4">
				<p className="text-sm text-gray-600">
					{ __(
						'Skills provide specialized capabilities for the AI assistant. Install skills to help the assistant with specific tasks.'
					) }
				</p>

				{ /* Error display */ }
				{ ( error || installError ) && (
					<div className="bg-red-50 border border-red-200 text-red-700 px-4 py-2 rounded text-sm">
						{ error || installError }
					</div>
				) }

				{ /* Loading state */ }
				{ isLoading ? (
					<div className="flex items-center justify-center py-8">
						<Spinner />
						<span className="ml-2 text-gray-600">{ __( 'Loading available skills...' ) }</span>
					</div>
				) : availableSkills.length === 0 && ! error ? (
					<div className="text-center py-8 text-gray-500">
						<p>{ __( 'No skills available in the repository.' ) }</p>
						<p className="text-xs mt-2">
							{ __(
								'The WordPress/agent-skills repository may not exist yet or does not contain a skills/ directory.'
							) }
						</p>
						<Button variant="link" onClick={ refresh } className="mt-2">
							{ __( 'Retry' ) }
						</Button>
					</div>
				) : availableSkills.length === 0 && error ? (
					<div className="text-center py-8 text-gray-500">
						<p>{ __( 'Could not load skills from the repository.' ) }</p>
						<Button variant="link" onClick={ refresh } className="mt-2">
							{ __( 'Retry' ) }
						</Button>
					</div>
				) : (
					<div className="flex flex-col gap-3 max-h-[400px] overflow-y-auto">
						{ availableSkills.map( ( skill ) => (
							<AvailableSkillCard
								key={ skill.path }
								name={ skill.name }
								description={ skill.description }
								path={ skill.path }
								isInstalled={ installedNames.has( skill.name ) }
								onInstall={ handleInstall }
								isInstalling={ isInstalling }
							/>
						) ) }
					</div>
				) }

				{ /* Footer */ }
				<div className="flex justify-between items-center pt-2 border-t border-gray-200">
					<p className="text-xs text-gray-500">
						{ __( 'Skills from ' ) }
						<a
							href="https://github.com/WordPress/agent-skills"
							target="_blank"
							rel="noopener noreferrer"
							className="text-a8c-blue-50 hover:underline"
						>
							WordPress/agent-skills
						</a>
					</p>
					<Button variant="secondary" onClick={ onClose }>
						{ __( 'Done' ) }
					</Button>
				</div>
			</div>
		</Modal>
	);
}
