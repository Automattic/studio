import {
	Button,
	CheckboxControl,
	FormToggle,
	Icon,
	MenuItem,
	MenuGroup,
	Notice,
	ProgressBar,
	SelectControl,
	Spinner,
	TextControl,
} from '@wordpress/components';
import {
	check,
	close,
	cog,
	copy,
	download,
	external,
	help,
	info,
	moreVertical,
	pencil,
	plugins,
	plus,
	trash,
	upload,
} from '@wordpress/icons';
import { useState } from 'react';

function Section( { title, children }: { title: string; children: React.ReactNode } ) {
	return (
		<div className="mb-8">
			<h4 className="a8c-label text-frame-text-secondary mb-3">{ title }</h4>
			{ children }
		</div>
	);
}

function Row( { children }: { children: React.ReactNode } ) {
	return <div className="flex flex-wrap items-center gap-3 mb-3">{ children }</div>;
}

function ButtonsSection() {
	return (
		<Section title="Button">
			<Row>
				<Button variant="primary">Primary</Button>
				<Button variant="secondary">Secondary</Button>
				<Button variant="tertiary">Tertiary</Button>
				<Button variant="link">Link</Button>
				<Button isDestructive variant="primary">
					Destructive
				</Button>
				<Button variant="primary" disabled>
					Disabled
				</Button>
			</Row>
			<Row>
				<Button variant="primary" icon={ plus }>
					With icon
				</Button>
				<Button variant="secondary" icon={ download }>
					Download
				</Button>
				<Button variant="tertiary" icon={ upload }>
					Upload
				</Button>
			</Row>
			<Row>
				<Button icon={ cog } label="Settings" />
				<Button icon={ help } label="Help" />
				<Button icon={ moreVertical } label="More" />
				<Button icon={ plus } label="Add" />
				<Button icon={ trash } label="Delete" isDestructive />
			</Row>
		</Section>
	);
}

function IconsSection() {
	const icons = [
		{ icon: check, name: 'check' },
		{ icon: close, name: 'close' },
		{ icon: cog, name: 'cog' },
		{ icon: copy, name: 'copy' },
		{ icon: download, name: 'download' },
		{ icon: external, name: 'external' },
		{ icon: help, name: 'help' },
		{ icon: info, name: 'info' },
		{ icon: moreVertical, name: 'moreVertical' },
		{ icon: pencil, name: 'pencil' },
		{ icon: plugins, name: 'plugins' },
		{ icon: plus, name: 'plus' },
		{ icon: trash, name: 'trash' },
		{ icon: upload, name: 'upload' },
	];

	return (
		<Section title="Icon (@wordpress/icons)">
			<div className="flex flex-wrap gap-4">
				{ icons.map( ( { icon, name } ) => (
					<div key={ name } className="flex flex-col items-center gap-1 text-frame-text">
						<Icon icon={ icon } size={ 24 } />
						<span className="text-[10px] text-frame-text-secondary">{ name }</span>
					</div>
				) ) }
			</div>
		</Section>
	);
}

function SpinnerSection() {
	return (
		<Section title="Spinner">
			<Row>
				<Spinner />
				<span className="a8c-body text-frame-text-secondary">Loading...</span>
			</Row>
		</Section>
	);
}

function FormControlsSection() {
	const [ text, setText ] = useState( '' );
	const [ select, setSelect ] = useState< string >( '8.3' );
	const [ checked, setChecked ] = useState( false );
	const [ toggled, setToggled ] = useState( false );

	return (
		<Section title="Form Controls">
			<div className="space-y-4 max-w-sm">
				<TextControl
					label="TextControl"
					value={ text }
					onChange={ setText }
					placeholder="Enter text..."
				/>
				<SelectControl
					label="SelectControl"
					value={ select }
					options={ [
						{ label: 'PHP 8.0', value: '8.0' as string },
						{ label: 'PHP 8.1', value: '8.1' as string },
						{ label: 'PHP 8.2', value: '8.2' as string },
						{ label: 'PHP 8.3', value: '8.3' as string },
					] }
					onChange={ ( val ) => setSelect( val ) }
				/>
				<CheckboxControl label="CheckboxControl" checked={ checked } onChange={ setChecked } />
				<div className="flex items-center gap-3">
					<FormToggle checked={ toggled } onChange={ () => setToggled( ! toggled ) } />
					<span className="a8c-body text-frame-text">FormToggle ({ toggled ? 'on' : 'off' })</span>
				</div>
			</div>
		</Section>
	);
}

function NoticeSection() {
	return (
		<Section title="Notice">
			<div className="space-y-2">
				<Notice status="info" isDismissible={ false }>
					Info notice
				</Notice>
				<Notice status="success" isDismissible={ false }>
					Success notice
				</Notice>
				<Notice status="warning" isDismissible={ false }>
					Warning notice
				</Notice>
				<Notice status="error" isDismissible={ false }>
					Error notice
				</Notice>
			</div>
		</Section>
	);
}

function ProgressBarSection() {
	return (
		<Section title="ProgressBar">
			<div className="space-y-3 max-w-sm">
				<ProgressBar value={ 30 } />
				<ProgressBar value={ 65 } />
				<ProgressBar />
			</div>
		</Section>
	);
}

function MenuSection() {
	return (
		<Section title="MenuGroup + MenuItem">
			<div className="border border-frame-border rounded-md overflow-hidden max-w-xs bg-frame">
				<MenuGroup>
					<MenuItem icon={ pencil } iconPosition="left">
						Edit site
					</MenuItem>
					<MenuItem icon={ copy } iconPosition="left">
						Copy site
					</MenuItem>
					<MenuItem icon={ download } iconPosition="left">
						Export
					</MenuItem>
				</MenuGroup>
				<MenuGroup>
					<MenuItem icon={ trash } iconPosition="left" isDestructive>
						Delete site
					</MenuItem>
				</MenuGroup>
			</div>
		</Section>
	);
}

export function ComponentLibrary() {
	return (
		<div className="space-y-2">
			<div className="mb-6">
				<h3 className="a8c-subtitle-small text-frame-text mb-1">Component Library</h3>
				<p className="a8c-body text-frame-text-secondary">
					WordPress components available via{ ' ' }
					<code className="bg-frame-surface px-1 rounded">@wordpress/components</code> and{ ' ' }
					<code className="bg-frame-surface px-1 rounded">@wordpress/icons</code>.
				</p>
			</div>
			<ButtonsSection />
			<IconsSection />
			<FormControlsSection />
			<SpinnerSection />
			<ProgressBarSection />
			<NoticeSection />
			<MenuSection />
		</div>
	);
}
