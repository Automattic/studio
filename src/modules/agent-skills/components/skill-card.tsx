/**
 * SkillCard component - displays information about a single installed skill.
 */

import { Icon, trash, file, archive } from '@wordpress/icons';
import { useI18n } from '@wordpress/react-i18n';
import { useState, useCallback } from 'react';
import Button from 'src/components/button';
import { cx } from 'src/lib/cx';
import type { Skill } from '../types';

interface SkillCardProps {
	/** The skill to display */
	skill: Skill;
	/** Callback when the remove button is clicked */
	onRemove: ( skillName: string ) => Promise< void >;
}

export function SkillCard( { skill, onRemove }: SkillCardProps ) {
	const { __ } = useI18n();
	const [ isRemoving, setIsRemoving ] = useState( false );
	const [ showConfirm, setShowConfirm ] = useState( false );

	const handleRemove = useCallback( async () => {
		setIsRemoving( true );
		try {
			await onRemove( skill.name );
		} catch ( err ) {
			console.error( 'Failed to remove skill:', err );
		} finally {
			setIsRemoving( false );
			setShowConfirm( false );
		}
	}, [ onRemove, skill.name ] );

	return (
		<div
			className={ cx(
				'border border-gray-200 rounded-md p-4 bg-white',
				'hover:border-gray-300 transition-colors'
			) }
		>
			<div className="flex items-start justify-between gap-3">
				<div className="flex-1 min-w-0">
					<h4 className="font-medium text-gray-900 truncate">{ skill.name }</h4>
					<p className="text-sm text-gray-600 mt-1 line-clamp-2">{ skill.description }</p>

					{ /* Optional capabilities */ }
					<div className="flex flex-wrap gap-2 mt-2">
						{ skill.hasScripts && (
							<span className="inline-flex items-center gap-1 text-xs text-gray-500 bg-gray-100 px-2 py-0.5 rounded">
								<Icon icon={ file } size={ 12 } />
								{ __( 'Scripts' ) }
							</span>
						) }
						{ skill.hasReferences && (
							<span className="inline-flex items-center gap-1 text-xs text-gray-500 bg-gray-100 px-2 py-0.5 rounded">
								<Icon icon={ archive } size={ 12 } />
								{ __( 'References' ) }
							</span>
						) }
						{ skill.allowedTools && skill.allowedTools.length > 0 && (
							<span className="text-xs text-gray-500 bg-gray-100 px-2 py-0.5 rounded">
								{ skill.allowedTools.length } { __( 'tools' ) }
							</span>
						) }
					</div>
				</div>

				<div className="flex-shrink-0">
					{ showConfirm ? (
						<div className="flex items-center gap-2">
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
								onClick={ handleRemove }
								disabled={ isRemoving }
								className="text-xs !text-a8c-red-50"
							>
								{ isRemoving ? __( 'Removing...' ) : __( 'Remove' ) }
							</Button>
						</div>
					) : (
						<Button
							variant="link"
							onClick={ () => setShowConfirm( true ) }
							className="!text-gray-400 hover:!text-a8c-red-50"
							aria-label={ __( 'Remove skill' ) }
						>
							<Icon icon={ trash } size={ 18 } />
						</Button>
					) }
				</div>
			</div>
		</div>
	);
}

interface AvailableSkillCardProps {
	/** Skill name */
	name: string;
	/** Skill description */
	description: string;
	/** Path within the repository */
	path: string;
	/** Whether this skill is already installed */
	isInstalled: boolean;
	/** Callback when install is clicked */
	onInstall: ( path: string ) => void;
	/** Whether installation is in progress */
	isInstalling: boolean;
}

export function AvailableSkillCard( {
	name,
	description,
	path,
	isInstalled,
	onInstall,
	isInstalling,
}: AvailableSkillCardProps ) {
	const { __ } = useI18n();

	return (
		<div
			className={ cx(
				'border border-gray-200 rounded-md p-4 bg-white',
				'hover:border-gray-300 transition-colors',
				isInstalled && 'opacity-60'
			) }
		>
			<div className="flex items-start justify-between gap-3">
				<div className="flex-1 min-w-0">
					<h4 className="font-medium text-gray-900 truncate">{ name }</h4>
					<p className="text-sm text-gray-600 mt-1 line-clamp-2">{ description }</p>
				</div>

				<div className="flex-shrink-0">
					{ isInstalled ? (
						<span className="text-xs text-gray-500 bg-gray-100 px-2 py-1 rounded">
							{ __( 'Installed' ) }
						</span>
					) : (
						<Button
							variant="secondary"
							onClick={ () => onInstall( path ) }
							disabled={ isInstalling }
							className="text-sm"
						>
							{ isInstalling ? __( 'Installing...' ) : __( 'Install' ) }
						</Button>
					) }
				</div>
			</div>
		</div>
	);
}
