import { __ } from '@wordpress/i18n';
import { EllipsisVerticalIcon } from '@/lib/icons';
import { Button, Menu, Tooltip, TooltipContent, TooltipTrigger } from '@/lib/ui';
import type { PreviewColorScheme } from '../preview-surface/webview';
import type { useFrontendAdminBar } from '@/data/queries/use-frontend-admin-bar';

export interface PreviewBrowserActions {
	colorScheme: PreviewColorScheme;
	onColorSchemeChange: ( value: PreviewColorScheme ) => void;
	onOpenDevTools: () => void;
	onClearBrowsingData: () => void;
	clearing: boolean;
}

export interface PreviewResponsiveActions {
	active: boolean;
	disabled: boolean;
	onClick: () => void;
}

export interface PreviewScreenshotActions {
	disabled: boolean;
	disabledReason?: string;
	capturing: boolean;
	onClick: () => void;
}

interface BrowserMenuItemsProps {
	actions?: PreviewBrowserActions;
	adminBar?: ReturnType< typeof useFrontendAdminBar >;
	responsive?: PreviewResponsiveActions;
	screenshot?: PreviewScreenshotActions;
	disabled?: boolean;
	annotation?: { active: boolean; disabled: boolean; disabledReason?: string; onClick: () => void };
}

function BrowserMenuItems( {
	actions,
	adminBar,
	responsive,
	screenshot,
	disabled,
	annotation,
}: BrowserMenuItemsProps ) {
	return (
		<>
			{ adminBar ? (
				<Menu.Item
					disabled={ disabled || adminBar.disabled }
					onClick={ () => adminBar.onChange( adminBar.value === 'show' ? 'hide' : 'show' ) }
				>
					{ adminBar.value === 'show' ? __( 'Hide admin bar' ) : __( 'Show admin bar' ) }
				</Menu.Item>
			) : null }
			{ responsive ? (
				<Menu.Item disabled={ disabled || responsive.disabled } onClick={ responsive.onClick }>
					{ responsive.active ? __( 'Hide device toolbar' ) : __( 'Show device toolbar' ) }
				</Menu.Item>
			) : null }
			{ ( annotation || screenshot || actions ) && ( adminBar || responsive ) ? (
				<Menu.Separator />
			) : null }
			{ annotation ? (
				<Menu.Item
					disabled={ disabled || annotation.disabled }
					onClick={ annotation.onClick }
					aria-description={ annotation.disabledReason }
				>
					{ annotation.active ? __( 'Stop annotating' ) : __( 'Annotate' ) }
				</Menu.Item>
			) : null }
			{ screenshot ? (
				<Menu.Item
					disabled={ disabled || screenshot.disabled || screenshot.capturing }
					aria-description={ screenshot.disabledReason }
					aria-busy={ screenshot.capturing || undefined }
					onClick={ screenshot.onClick }
				>
					{ screenshot.capturing ? __( 'Taking screenshot…' ) : __( 'Take screenshot' ) }
				</Menu.Item>
			) : null }
			{ actions ? (
				<>
					<Menu.SubmenuRoot>
						<Menu.SubmenuTrigger disabled={ disabled }>{ __( 'Appearance' ) }</Menu.SubmenuTrigger>
						<Menu.SubmenuPopup>
							<Menu.RadioGroup
								value={ actions.colorScheme }
								onValueChange={ ( value ) =>
									actions.onColorSchemeChange( value as PreviewColorScheme )
								}
							>
								<Menu.RadioItem value="system">{ __( 'System' ) }</Menu.RadioItem>
								<Menu.RadioItem value="light">{ __( 'Light' ) }</Menu.RadioItem>
								<Menu.RadioItem value="dark">{ __( 'Dark' ) }</Menu.RadioItem>
							</Menu.RadioGroup>
						</Menu.SubmenuPopup>
					</Menu.SubmenuRoot>
					<Menu.Item disabled={ disabled } onClick={ actions.onOpenDevTools }>
						{ __( 'Developer tools' ) }
					</Menu.Item>
					<Menu.Separator />
					<Menu.Item
						disabled={ disabled || actions.clearing }
						onClick={ actions.onClearBrowsingData }
					>
						{ __( 'Clear browsing data' ) }
					</Menu.Item>
				</>
			) : null }
		</>
	);
}

export function BrowserMenu( {
	className,
	...props
}: BrowserMenuItemsProps & { className?: string } ) {
	return (
		<Menu.Root
			onOpenChange={ ( open ) => {
				if ( open ) props.adminBar?.onRead();
			} }
		>
			<Tooltip>
				<Menu.Trigger
					render={
						<TooltipTrigger
							render={
								<Button
									variant="ghost"
									size="icon-sm"
									className={ className }
									data-preview-browser-options
									aria-label={ __( 'Browser options' ) }
								/>
							}
						/>
					}
				>
					<EllipsisVerticalIcon />
				</Menu.Trigger>
				<TooltipContent side="bottom">{ __( 'Browser options' ) }</TooltipContent>
			</Tooltip>
			<Menu.Popup side="bottom" align="end">
				<BrowserMenuItems { ...props } />
			</Menu.Popup>
		</Menu.Root>
	);
}
