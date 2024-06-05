interface MenuIconProps {
	fill?: string;
}

export const MenuIcon: React.FC< MenuIconProps > = ( { fill = '#65696f' } ) => (
	<svg width="4" height="16" viewBox="0 0 4 16" fill="none" xmlns="http://www.w3.org/2000/svg">
		<circle cx="2" cy="2" r="2" fill={ fill } />
		<circle cx="2" cy="8" r="2" fill={ fill } />
		<circle cx="2" cy="14" r="2" fill={ fill } />
	</svg>
);
