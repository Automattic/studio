import { WordPressLogo } from '@/components/wordpress-logo';

interface LibraryHeaderProps {
	query: string;
	onQueryChange: ( query: string ) => void;
}

export function LibraryHeader( { query, onQueryChange }: LibraryHeaderProps ) {
	return (
		<header className="header">
			<div className="brand">
				<WordPressLogo />
				<div>
					<h1 className="title">WordPress</h1>
					<p className="summary">Your local Studio sites.</p>
				</div>
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
