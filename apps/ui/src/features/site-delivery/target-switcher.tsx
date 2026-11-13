import { getProviderSites } from '@studio/providers';
import { __ } from '@wordpress/i18n';
import { useId } from 'react';
import { getSnapshotHostname } from '@/data/snapshot-url';
import { ChevronDownIcon, LinkIcon, MapPinIcon, PlusIcon } from '@/lib/icons';
import { Button, Menu } from '@/lib/ui';
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
	onNewPreview,
	newPreviewDisabled,
}: {
	targets: PublishTarget[];
	selectedKey: string;
	hostname: string;
	locale?: string;
	disabled: boolean;
	onSelect: ( target: PublishTarget ) => void;
	onNewPreview?: () => void;
	newPreviewDisabled?: boolean;
} ) {
	const id = useId();
	const sites = targets.filter( ( target ) => target.remote );
	const previews = targets.filter( ( target ) => target.snapshot );
	const renderItem = ( target: PublishTarget ) => {
		const { key, provider, remote, snapshot } = target;
		const label =
			key === selectedKey
				? hostname
				: snapshot
				? getSnapshotHostname( snapshot )
				: new URL( remote!.url ).hostname;
		const description = describePublishTarget( target, locale, targets );
		const descriptionId = `${ id }-${ key }`;
		return (
			<Menu.RadioItem
				key={ key }
				value={ key }
				aria-label={ label }
				aria-describedby={ description ? descriptionId : undefined }
				className={ remote ? styles.providerMenuItem : styles.destinationMenuItem }
				data-address-theme={
					remote ? getProviderSites( provider ).publishing.addressTheme : undefined
				}
				onClick={ () => onSelect( target ) }
			>
				{ snapshot ? <LinkIcon /> : <ProviderLogo provider={ provider } branded compact /> }
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
		<div>
			<Menu.Root>
				<Menu.Trigger
					render={
						<Button
							variant="ghost"
							className={ styles.accessTrigger }
							disabled={ disabled }
							aria-label={ __( 'Choose destination' ) }
							aria-description={ hostname }
						/>
					}
				>
					<MapPinIcon data-icon="inline-start" />
					<span className={ styles.previewHostname }>{ hostname }</span>
					<ChevronDownIcon data-icon="inline-end" data-dropdown-indicator />
				</Menu.Trigger>
				<Menu.Popup
					side="bottom"
					align="center"
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
					{ onNewPreview && (
						<>
							{ ' ' }
							<Menu.Separator />
							<Menu.Item disabled={ newPreviewDisabled } onClick={ onNewPreview }>
								<PlusIcon />
								{ __( 'New preview' ) }
							</Menu.Item>
						</>
					) }
				</Menu.Popup>
			</Menu.Root>
		</div>
	);
}
