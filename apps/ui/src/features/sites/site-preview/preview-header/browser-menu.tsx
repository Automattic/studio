import { __ } from '@wordpress/i18n';
import { EllipsisVerticalIcon } from 'lucide-react';
import { Button, Menu, Tooltip, TooltipContent, TooltipTrigger } from '@/lib/ui';
import type { PreviewColorScheme } from '../preview-surface/webview';
import type {
	FrontendAdminBarPreference,
	useFrontendAdminBar,
} from '@/data/queries/use-frontend-admin-bar';

export interface PreviewBrowserActions {
	colorScheme: PreviewColorScheme;
	onColorSchemeChange: ( value: PreviewColorScheme ) => void;
	onOpenDevTools: () => void;
	onClearBrowsingData: () => void;
	clearing: boolean;
}

interface BrowserMenuItemsProps {
	actions?: PreviewBrowserActions;
	adminBar?: ReturnType< typeof useFrontendAdminBar >;
	disabled?: boolean;
}

function BrowserMenuItems( { actions, adminBar, disabled }: BrowserMenuItemsProps ) {
	return (
		<>
			{ actions ? (
				<>
					<Menu.Item disabled={ disabled } onClick={ actions.onOpenDevTools }>
						{ __( 'Open DevTools' ) }
					</Menu.Item>
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
				</>
			) : null }
			{ adminBar ? (
				<Menu.SubmenuRoot>
					<Menu.SubmenuTrigger disabled={ disabled || adminBar.saving }>
						{ __( 'Admin bar' ) }
					</Menu.SubmenuTrigger>
					<Menu.SubmenuPopup>
						<Menu.RadioGroup
							value={ adminBar.value }
							onValueChange={ ( value ) =>
								adminBar.onChange( value as FrontendAdminBarPreference )
							}
						>
							<Menu.RadioItem value="default">{ __( 'Use Studio default' ) }</Menu.RadioItem>
							<Menu.RadioItem value="show">{ __( 'Show' ) }</Menu.RadioItem>
							<Menu.RadioItem value="hide">{ __( 'Hide' ) }</Menu.RadioItem>
						</Menu.RadioGroup>
					</Menu.SubmenuPopup>
				</Menu.SubmenuRoot>
			) : null }
			{ actions ? (
				<>
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
		<Menu.Root>
			<Tooltip>
				<Menu.Trigger
					render={
						<TooltipTrigger
							render={
								<Button
									variant="ghost"
									size="icon-sm"
									className={ className }
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
