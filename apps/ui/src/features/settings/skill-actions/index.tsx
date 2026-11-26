import { IconButton, Menu } from '@studio/ds';
import { ExternalLinkIcon, PencilIcon, TrashIcon } from '@studio/ds/icons';
import { __, sprintf } from '@wordpress/i18n';
import { EllipsisIcon } from 'lucide-react';
import { Children } from 'react';
import { toast } from '@/data/app-messages';
import { useConnector } from '@/data/core';
import { AppIcon } from '@/features/sites';
import type { ReactNode } from 'react';

const SKILL_SOURCES: Record< string, string > = {
	'studio-cli': 'https://github.com/Automattic/studio/tree/trunk/skills/studio-cli',
	'wp-plugin-development':
		'https://github.com/WordPress/agent-skills/tree/trunk/skills/wp-plugin-development',
	'wp-block-development':
		'https://github.com/WordPress/agent-skills/tree/trunk/skills/wp-block-development',
	'wp-block-themes': 'https://github.com/WordPress/agent-skills/tree/trunk/skills/wp-block-themes',
	'wp-rest-api': 'https://github.com/WordPress/agent-skills/tree/trunk/skills/wp-rest-api',
	'wp-wpcli-and-ops':
		'https://github.com/WordPress/agent-skills/tree/trunk/skills/wp-wpcli-and-ops',
};

export function SkillActions( {
	id,
	name,
	disabled,
	children,
	onEdit,
	onRemove,
	removeLabel,
}: {
	id?: string;
	name: string;
	disabled?: boolean;
	children?: ReactNode;
	// Opens the skill in its form, for a skill the user can change here.
	onEdit?: () => void;
	onRemove?: () => void;
	// What removing is called here; "Uninstall" for the files Studio ships.
	removeLabel?: string;
} ) {
	const connector = useConnector();
	const source =
		id && Object.prototype.hasOwnProperty.call( SKILL_SOURCES, id )
			? SKILL_SOURCES[ id ]
			: undefined;
	const hasLocalDestinations = Children.count( children ) > 0;
	if ( ! source && ! hasLocalDestinations && ! onEdit && ! onRemove ) {
		return null;
	}
	return (
		<Menu.Root>
			<Menu.Trigger
				render={
					<IconButton
						size="icon-sm"
						icon={ <EllipsisIcon /> }
						/* translators: %s: a skill or instruction file name. */
						label={ sprintf( __( 'Actions for %s' ), name ) }
						disabled={ disabled }
					/>
				}
			/>
			<Menu.Popup side="bottom" align="end">
				{ onEdit ? (
					<Menu.Item onClick={ onEdit }>
						<PencilIcon />
						{ __( 'Edit' ) }
					</Menu.Item>
				) : null }
				{ hasLocalDestinations ? (
					<Menu.SubmenuRoot>
						<Menu.SubmenuTrigger>
							<ExternalLinkIcon />
							{ __( 'Open in' ) }
						</Menu.SubmenuTrigger>
						<Menu.SubmenuPopup>{ children }</Menu.SubmenuPopup>
					</Menu.SubmenuRoot>
				) : null }
				{ source ? (
					<Menu.Item
						onClick={ () => {
							void connector.openExternalUrl( source ).catch( ( error: Error ) => {
								toast.error( error.message );
							} );
						} }
					>
						<AppIcon app="github" fallback={ <ExternalLinkIcon /> } />
						{ __( 'Open on GitHub' ) }
					</Menu.Item>
				) : null }
				{ onRemove ? (
					<>
						{ onEdit || hasLocalDestinations || source ? <Menu.Separator /> : null }
						<Menu.Item destructive onClick={ onRemove }>
							<TrashIcon />
							{ removeLabel ?? __( 'Uninstall' ) }
						</Menu.Item>
					</>
				) : null }
			</Menu.Popup>
		</Menu.Root>
	);
}
