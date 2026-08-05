import { chevronDown, Icon } from '@wordpress/icons';
import { Button, Tooltip } from '@wordpress/ui';
import * as Menu from '@/components/menu';
import styles from './style.module.css';
import type { ReactElement, ReactNode } from 'react';

export interface SplitButtonMenuItem {
	id: string;
	label: string;
	icon: ReactElement;
	disabled?: boolean;
	onSelect: () => void;
}

interface SplitButtonMenuProps {
	actionLabel: string;
	actionIcon: ReactElement;
	actionDisabled?: boolean;
	onAction: () => void;
	menuLabel: string;
	items: SplitButtonMenuItem[];
	footer?: ReactNode;
}

export function SplitButtonMenu( {
	actionLabel,
	actionIcon,
	actionDisabled,
	onAction,
	menuLabel,
	items,
	footer,
}: SplitButtonMenuProps ) {
	return (
		<Menu.Root>
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
								disabled={ actionDisabled }
								onClick={ onAction }
							/>
						}
					>
						<Icon icon={ actionIcon } size={ 18 } />
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
								<Icon
									icon={ chevronDown }
									size={ 12 }
									className={ styles.chevron }
									data-keep-size
								/>
							</Tooltip.Trigger>
						}
					/>
					<Tooltip.Popup positioner={ <Tooltip.Positioner side="bottom" /> }>
						{ menuLabel }
					</Tooltip.Popup>
				</Tooltip.Root>
			</div>
			<Menu.Popup side="bottom" align="end" className={ styles.popup }>
				{ items.map( ( item ) => (
					<Menu.Item key={ item.id } disabled={ item.disabled } onClick={ item.onSelect }>
						<span className={ styles.itemIcon } aria-hidden="true">
							<Icon icon={ item.icon } size={ 18 } />
						</span>
						{ item.label }
					</Menu.Item>
				) ) }
				{ footer ? (
					<>
						<Menu.Separator />
						{ footer }
					</>
				) : null }
			</Menu.Popup>
		</Menu.Root>
	);
}
