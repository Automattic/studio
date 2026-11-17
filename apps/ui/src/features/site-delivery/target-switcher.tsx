import { __ } from '@wordpress/i18n';
import { useId } from 'react';
import { LinkIcon, MapPinIcon } from '@/lib/icons';
import { Menu } from '@/lib/ui';
import { ProviderLogo } from './provider-logo';
import styles from './style.module.css';
import { describePublishTarget } from './target-description';
import type { PublishTarget } from './use-publish-targets';

export function TargetSwitcher( {
	targets,
	selectedKey,
	hostname,
	locale,
	disabled,
	onSelect,
}: {
	targets: PublishTarget[];
	selectedKey: string;
	hostname: string;
	locale?: string;
	disabled: boolean;
	onSelect: ( target: PublishTarget ) => void;
} ) {
	const id = useId();
	const sites = targets.filter( ( target ) => target.remote );
	const previews = targets.filter( ( target ) => target.snapshot );
	const selected = targets.find( ( target ) => target.key === selectedKey );
	const selectedLabel = selected?.snapshot ? selected.label : hostname;
	const renderItem = ( target: PublishTarget ) => {
		const { key, provider, remote, snapshot } = target;
		const label = key === selectedKey ? selectedLabel : target.label;
		const description = describePublishTarget( target, locale, targets );
		const descriptionId = `${ id }-${ key }`;
		return (
			<Menu.RadioItem
				key={ key }
				value={ key }
				aria-label={ label }
				aria-describedby={ description ? descriptionId : undefined }
				className={ styles.destinationMenuItem }
				onClick={ () => onSelect( target ) }
			>
				{ snapshot ? (
					<LinkIcon />
				) : (
					<ProviderLogo provider={ provider } site={ remote } branded compact />
				) }
				<span className={ styles.accessChoiceText }>
					<span className={ styles.previewHostname } title={ label }>
						{ label }
					</span>
					{ description && (
						<span id={ descriptionId } className={ styles.accessDescription }>
							{ description }
						</span>
					) }
				</span>
			</Menu.RadioItem>
		);
	};
	return (
		<Menu.SubmenuRoot>
			<Menu.SubmenuTrigger disabled={ disabled }>
				<MapPinIcon />
				{ __( 'Switch to' ) }
			</Menu.SubmenuTrigger>
			<Menu.SubmenuPopup
				className={ styles.targetSwitcherMenu }
				aria-label={ __( 'Destinations' ) }
			>
				<Menu.RadioGroup value={ selectedKey }>
					{ sites.length > 0 && previews.length > 0 ? (
						<>
							<Menu.Group aria-label={ __( 'Connected sites' ) }>
								<div className={ styles.destinationMenuHeading } aria-hidden="true">
									{ __( 'Connected sites' ) }
								</div>
								{ sites.map( renderItem ) }
							</Menu.Group>
							<Menu.Separator />
							<Menu.Group aria-label={ __( 'Previews' ) }>
								<div className={ styles.destinationMenuHeading } aria-hidden="true">
									{ __( 'Previews' ) }
								</div>
								{ previews.map( renderItem ) }
							</Menu.Group>
						</>
					) : (
						targets.map( renderItem )
					) }
				</Menu.RadioGroup>
			</Menu.SubmenuPopup>
		</Menu.SubmenuRoot>
	);
}
