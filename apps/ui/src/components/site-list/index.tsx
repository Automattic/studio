import { Icon, chevronDown, chevronRight, plus } from '@wordpress/icons';
import { Button, Collapsible, Stack } from '@wordpress/ui';
import { useState } from 'react';
import { useSites } from '@/data/queries/use-sites';
import styles from './style.module.css';

export function SiteList() {
	const { data: sites, isLoading } = useSites();
	const [ open, setOpen ] = useState( true );

	return (
		<Collapsible.Root open={ open } onOpenChange={ setOpen } className={ styles.root }>
			<Stack direction="row" align="center" justify="space-between">
				<Collapsible.Trigger
					render={
						<Button variant="minimal" tone="neutral" size="compact">
							<span className={ styles.title }>Projects</span>
							<Icon icon={ open ? chevronDown : chevronRight } size={ 18 } />
						</Button>
					}
				/>
				<Button variant="minimal" tone="neutral" size="compact">
					Stop all
				</Button>
			</Stack>
			<Collapsible.Panel>
				{ isLoading ? (
					<p className={ styles.loading }>Loading...</p>
				) : (
					<ul className={ styles.list }>
						{ sites?.map( ( site ) => (
							<li key={ site.id } className={ styles.item }>
								{ site.name }
							</li>
						) ) }
					</ul>
				) }
				<Button variant="minimal" tone="neutral" size="compact">
					<Icon icon={ plus } size={ 18 } />
					<span>Add site</span>
				</Button>
			</Collapsible.Panel>
		</Collapsible.Root>
	);
}
