import { __, sprintf } from '@wordpress/i18n';
import { EllipsisVerticalIcon } from 'lucide-react';
import { Button, Menu, Tooltip, TooltipContent, TooltipTrigger } from '@/lib/ui';
import type { PreviewColorScheme } from '../preview-surface/webview';

export interface PreviewBrowserActions {
	colorScheme: PreviewColorScheme;
	browserName?: string;
	onColorSchemeChange: ( value: PreviewColorScheme ) => void;
	onOpenDevTools: () => void;
	onClearBrowsingData: () => void;
	clearing: boolean;
}

interface BrowserMenuItemsProps {
	actions: PreviewBrowserActions;
	onOpenExternal?: () => void;
	disabled?: boolean;
}

function BrowserMenuItems( { actions, onOpenExternal, disabled }: BrowserMenuItemsProps ) {
	return (
		<>
			<Menu.Item disabled={ disabled } onClick={ actions.onOpenDevTools }>
				{ __( 'Open DevTools' ) }
			</Menu.Item>
			<Menu.Item disabled={ disabled || ! onOpenExternal } onClick={ onOpenExternal }>
				{ actions.browserName
					? sprintf(
							/* translators: %s is the browser name, e.g. Safari or Google Chrome. */
							__( 'Open in %s' ),
							actions.browserName
					  )
					: __( 'Open in browser' ) }
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
			<Menu.Separator />
			<Menu.Item disabled={ disabled || actions.clearing } onClick={ actions.onClearBrowsingData }>
				{ __( 'Clear browsing data' ) }
			</Menu.Item>
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
