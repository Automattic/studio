import { WordPressLogo } from '@/components/wordpress-logo';
import { useConnector } from '@/data/core';
import { useHostState } from '@/hooks/use-host-state';
import { canDisplay, isPage } from '@/lib/host-capabilities';

interface LibraryHeaderProps {
	query: string;
	onQueryChange: ( query: string ) => void;
}

export function LibraryHeader( { query, onQueryChange }: LibraryHeaderProps ) {
	const connector = useConnector();
	const { context } = useHostState();
	const page = isPage( context );
	const mode = page ? 'inline' : 'fullscreen';
	return (
		<header className="header">
			<div className="brand">
				<WordPressLogo />
				<div>
					<h1 className="title">WordPress</h1>
					<p className="summary">Your Studio sites and WordPress.com sites.</p>
				</div>
			</div>
			<div className="actions">
				<button
					type="button"
					data-kind="quiet"
					data-size="sm"
					hidden={ ! canDisplay( context, mode ) }
					onClick={ () => void connector.requestDisplayMode( mode ).catch( () => undefined ) }
				>
					{ page ? 'Collapse' : 'Expand' }
				</button>
			</div>
			<div className="search" role="search">
				<input
					className="input"
					type="search"
					aria-label="Search sites"
					placeholder="Search your sites"
					maxLength={ 200 }
					value={ query }
					onChange={ ( event ) => onQueryChange( event.target.value ) }
				/>
			</div>
		</header>
	);
}
