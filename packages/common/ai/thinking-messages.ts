// Working messages shown while the agent runs: one overarching WordPress
// theme, delivered with a mix of whimsy, fact, and the occasional bit of
// poetry. Keep entries short enough to sit on one line next to the elapsed
// counter, and always end with an ellipsis.
export const THINKING_MESSAGES = [
	'Consulting the Codex…',
	'Warming up the Loop…',
	'Hooking into wp_head…',
	'Filtering the_content…',
	'Enqueueing bright ideas…',
	'Flushing the permalinks…',
	'Whispering to the database…',
	'Herding template parts…',
	'Dusting off functions.php…',
	'Negotiating with a shortcode…',
	'Composing in blocks…',
	'Teaching Gutenberg a new trick…',
	'Wrangling widgets…',
	'Escaping the output…',
	'Sanitizing the inputs…',
	'Waking the cron jobs…',
	'Counting posts like sheep…',
	'Asking Wapuu for a second opinion…',
	'Sketching in HTML…',
	'Thinking in blocks…',
	'Turning ideas into markup…',
	'Pressing words…',
	'Tending the template hierarchy…',
	'Planting evergreen content…',
	'Polishing the pixels…',
	'Aligning things wide…',
	'Reading the fine manual…',
	'Running the five-minute install…',
	'Minding the child themes…',
	'Chasing a stray div…',
	'Balancing the brackets…',
	'Naming things carefully…',
] as const;

// Draw from a shuffled deck rather than rolling dice so every message shows
// before any repeats, and the same message can never appear twice in a row.
let deck: string[] = [];
let lastMessage: string | null = null;

function reshuffleDeck() {
	deck = [ ...THINKING_MESSAGES ];
	for ( let i = deck.length - 1; i > 0; i-- ) {
		const j = Math.floor( Math.random() * ( i + 1 ) );
		[ deck[ i ], deck[ j ] ] = [ deck[ j ], deck[ i ] ];
	}
	// Draws come off the end; if the fresh deck would start by repeating the
	// last draw of the previous deck, bury that card at the bottom.
	const top = deck[ deck.length - 1 ];
	if ( top === lastMessage ) {
		deck[ deck.length - 1 ] = deck[ 0 ];
		deck[ 0 ] = top;
	}
}

export function randomThinkingMessage(): string {
	if ( deck.length === 0 ) {
		reshuffleDeck();
	}
	lastMessage = deck.pop() as string;
	return lastMessage;
}
