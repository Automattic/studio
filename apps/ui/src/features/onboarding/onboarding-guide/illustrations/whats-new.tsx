import { __ } from '@wordpress/i18n';
import { displayShortcut } from '@wordpress/keycodes';
import { clsx } from 'clsx';
import { ArrowUpIcon, ChevronDownIcon, PlusIcon, SearchIcon } from 'lucide-react';
import { ChatIcon, GlobeIcon, ShareIcon, SyncIcon } from '@/lib/icons';
import styles from './whats-new.module.css';
import type { CSSProperties } from 'react';

// Still scenes for the What's New pages, drawn with the theme's tokens so they
// follow the color scheme and the user's accent like the app does.

function SidebarRow( {
	icon,
	label,
	nested,
	selected,
	unread,
}: {
	icon?: 'site' | 'chat';
	label: string;
	nested?: boolean;
	selected?: boolean;
	unread?: boolean;
} ) {
	return (
		<div
			className={ clsx( styles.row, nested && styles.rowNested, selected && styles.rowSelected ) }
		>
			{ icon === 'site' ? <GlobeIcon className={ styles.rowIcon } /> : null }
			{ icon === 'chat' ? <ChatIcon className={ styles.rowIcon } /> : null }
			<span className={ styles.rowLabel }>{ label }</span>
			{ unread ? <span className={ styles.unread } /> : null }
		</div>
	);
}

export function WorkspaceIllustration() {
	return (
		<div className={ styles.workspace } aria-hidden="true">
			<div className={ styles.sidebar }>
				<div className={ styles.sectionLabel }>{ __( 'Sites' ) }</div>
				<SidebarRow icon="site" label="Bistro Lune" />
				<SidebarRow nested label={ __( 'Write an About page' ) } />
				<SidebarRow nested selected label={ __( 'Plan a menu page' ) } />
				<SidebarRow nested unread label={ __( 'Add opening hours' ) } />
				<SidebarRow icon="site" label="Ada Portfolio" />
			</div>
			<div className={ styles.preview }>
				<div className={ styles.previewTitle }>Bistro Lune</div>
				<div className={ styles.previewHeading } />
				<div className={ styles.previewLine } />
				<div className={ clsx( styles.previewLine, styles.previewLineShort ) } />
			</div>
		</div>
	);
}

export function StudioCodeIllustration() {
	return (
		<div className={ styles.studioCode } aria-hidden="true">
			<div className={ styles.prompt }>{ __( 'Add opening hours to the footer' ) }</div>
			<div className={ styles.reply }>
				{ __( 'The footer now lists the hours for every day.' ) }
			</div>
			<div className={ styles.composer }>
				<span className={ styles.composerPlaceholder }>{ __( 'Work with Bistro Lune' ) }</span>
				<div className={ styles.composerBar }>
					<PlusIcon className={ styles.composerIcon } />
					<span className={ styles.chip }>
						<GlobeIcon />
						{ __( 'Live' ) }
					</span>
					<span className={ styles.model }>
						{ __( 'Fast' ) }
						<ChevronDownIcon />
					</span>
					<span className={ styles.send }>
						<ArrowUpIcon />
					</span>
				</div>
			</div>
		</div>
	);
}

export function PublishShareIllustration() {
	return (
		<div className={ styles.publish } aria-hidden="true">
			<div className={ styles.band }>
				<div className={ styles.address }>localhost:8881</div>
				<span className={ styles.publishButton }>{ __( 'Publish' ) }</span>
				<span className={ styles.iconButton }>
					<ShareIcon />
				</span>
			</div>
			<div className={ styles.panel }>
				<div className={ styles.panelLabel }>{ __( 'Publish to' ) }</div>
				<div className={ styles.panelField }>bistrolune.wordpress.com</div>
				<span className={ styles.panelButton }>{ __( 'Publish' ) }</span>
			</div>
		</div>
	);
}

export function CommandPaletteIllustration() {
	return (
		<div className={ styles.paletteScene } aria-hidden="true">
			<div className={ styles.palette }>
				<div className={ styles.paletteInput }>
					<SearchIcon className={ styles.paletteSearch } />
					<span>pub</span>
					<kbd className={ styles.kbd }>{ displayShortcut.primary( 'k' ) }</kbd>
				</div>
				<div className={ styles.paletteGroup }>{ __( 'Commands' ) }</div>
				<div className={ clsx( styles.paletteItem, styles.paletteItemActive ) }>
					<SyncIcon className={ styles.paletteItemIcon } />
					<span>{ __( 'Publish & Sync…' ) }</span>
					<span className={ styles.paletteItemMeta }>Bistro Lune</span>
				</div>
				<div className={ styles.paletteItem }>
					<ShareIcon className={ styles.paletteItemIcon } />
					<span>{ __( 'Share site…' ) }</span>
					<span className={ styles.paletteItemMeta }>Bistro Lune</span>
				</div>
			</div>
		</div>
	);
}

const SWATCHES = [ '#3858e9', '#069e08', '#8c52d9' ];

export function AppearanceIllustration() {
	return (
		<div
			className={ styles.appearance }
			style={ { '--scene-accent': SWATCHES[ 2 ] } as CSSProperties }
			aria-hidden="true"
		>
			<div className={ styles.card }>
				<div className={ styles.setting }>
					<span>{ __( 'Color' ) }</span>
					<span className={ styles.swatches }>
						{ SWATCHES.map( ( color, index ) => (
							<span
								key={ color }
								className={ clsx( styles.swatch, index === 2 && styles.swatchSelected ) }
								style={ { backgroundColor: color } }
							/>
						) ) }
					</span>
				</div>
				<div className={ styles.setting }>
					<span>{ __( 'Intensity' ) }</span>
					<span className={ styles.slider }>
						<span className={ styles.sliderFill } />
						<span className={ styles.sliderThumb } />
					</span>
				</div>
				<div className={ styles.setting }>
					<span>{ __( 'Contrast' ) }</span>
					<span className={ styles.slider }>
						<span className={ clsx( styles.sliderFill, styles.sliderFillLow ) } />
						<span className={ clsx( styles.sliderThumb, styles.sliderThumbLow ) } />
					</span>
				</div>
			</div>
		</div>
	);
}
