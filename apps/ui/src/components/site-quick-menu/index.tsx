import { chevronDown, Icon } from '@wordpress/icons';
import { Button, Tooltip } from '@wordpress/ui';
import * as Menu from '@/components/menu';
import { Spinner } from '@/components/spinner';
import styles from './style.module.css';
import type { ReactElement, ReactNode } from 'react';

/**
 * Shared building blocks for the compact dropdown menus pinned to the top
 * right of the site panels (Open in…, Customize).
 *
 * The trigger is a split button: the icon half performs the default (last
 * used) action directly, the chevron half opens the dropdown.
 */

export function QuickMenuTrigger( {
	menuLabel,
	actionLabel,
	logo,
	onActionClick,
	busy = false,
}: {
	menuLabel: string;
	actionLabel: string;
	logo: ReactElement;
	onActionClick: () => void;
	// The action half shows a spinner and stops accepting clicks while its
	// work is in flight (the dropdown half stays usable).
	busy?: boolean;
} ) {
	return (
		<div className={ styles.splitTrigger }>
			<Tooltip.Root>
				<Tooltip.Trigger
					render={
						<Button
							variant="minimal"
							tone="neutral"
							size="small"
							className={ styles.splitAction }
							aria-label={ actionLabel }
							aria-busy={ busy }
							disabled={ busy }
							onClick={ onActionClick }
						/>
					}
				>
					{ busy ? <Spinner label={ actionLabel } /> : <Icon icon={ logo } size={ 18 } /> }
				</Tooltip.Trigger>
				<Tooltip.Popup positioner={ <Tooltip.Positioner side="bottom" /> }>
					{ actionLabel }
				</Tooltip.Popup>
			</Tooltip.Root>
			<Tooltip.Root>
				<Menu.Trigger
					render={
						<Tooltip.Trigger
							render={
								<Button
									variant="minimal"
									tone="neutral"
									size="small"
									className={ styles.splitMenuButton }
									aria-label={ menuLabel }
								/>
							}
						>
							{ /* data-keep-size opts out of the classic-UI rule that
							     forces svgs to 16px, letting the chevron render
							     small enough for a narrow tab. */ }
							<Icon icon={ chevronDown } size={ 12 } className={ styles.chevron } data-keep-size />
						</Tooltip.Trigger>
					}
				/>
				<Tooltip.Popup positioner={ <Tooltip.Positioner side="bottom" /> }>
					{ menuLabel }
				</Tooltip.Popup>
			</Tooltip.Root>
		</div>
	);
}

export function QuickMenuPopup( { children }: { children: ReactNode } ) {
	return (
		<Menu.Popup side="bottom" align="end" className={ styles.popup }>
			{ children }
		</Menu.Popup>
	);
}

export function QuickMenuItem( {
	icon,
	label,
	shortcut,
	onClick,
	disabled,
	destructive,
}: {
	icon: ReactElement;
	label: string;
	// Right-aligned muted keyboard hint, e.g. "Hold ⌘".
	shortcut?: string;
	onClick: () => void;
	disabled?: boolean;
	destructive?: boolean;
} ) {
	return (
		<Menu.Item
			disabled={ disabled }
			onClick={ onClick }
			className={ destructive ? styles.destructiveItem : undefined }
		>
			<span className={ styles.itemIcon } aria-hidden="true">
				<Icon icon={ icon } size={ 18 } />
			</span>
			{ label }
			{ shortcut ? <span className={ styles.itemShortcut }>{ shortcut }</span> : null }
		</Menu.Item>
	);
}
