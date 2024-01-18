import Button from './button';

export default function DefaultErrorFallback() {
	return (
		<div className="flex flex-col items-center gap-4 text-center">
			<h1 className="text-2xl font-light">Something went wrong 😭</h1>
			<p className="max-w-md">
				We've logged the issue to help us track down the problem. Reloading <i>might</i> help in the
				meantime.
			</p>
			<Button onClick={ () => window.location.reload() }>Reload</Button>
		</div>
	);
}
