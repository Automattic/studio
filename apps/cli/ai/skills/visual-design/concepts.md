# Signature Concepts

Catalog behind the `visual-design` skill's concept shortlist. The Skill tool samples a random, category-spread subset of these entries into the runbook on every load, so the same brief gets a different shortlist each run. Headings nest three deep: `##` is a role (Moment, System, Detail), `###` a category within that role, `####` one concept with three fixed lines: **Fits**, **Build**, **Fallback**.

The bar for an entry: a template would never ship it, and a visitor would describe it to a friend. Every concept is written to be buildable inside a block theme with the tools Studio Code has: `theme.json`, `style.css`, patterns, and a small vanilla script enqueued from `functions.php`. No external libraries or CDNs, no WebGL or canvas, no sourced media. Content stays editable in blocks. Motion respects `prefers-reduced-motion`, and CSS scroll-driven animations (`animation-timeline: scroll()` / `view()`) sit inside `@supports` with a static or IntersectionObserver fallback.

## Moment

The first impression: the cover, the hero, how the story unfolds on scroll, or the object the site pretends to be.

### Hero & cover

#### Four-tile cover
A cover made of four squares that together fill the viewport; each tile carries one part of the hero (image, headline, color field, call to action) and enters with a short stagger.
Fits: studios, portfolios, brands with strong imagery or a four-part offer.
Build: full-height group with a 2×2 CSS grid (`height: 100dvh`), each tile a group or cover block; entrance via `@keyframes` with per-tile `animation-delay`.
Fallback: tiles stack into a single column on small screens; no entrance animation under reduced motion.

#### Split cover with a moving seam
Two half-screen panels (image and message) share a seam that slides toward the side the visitor hovers or scrolls toward, revealing more of it.
Fits: two-audience businesses, before/after services, duo brands.
Build: grid with `grid-template-columns: var(--seam, 1fr) 1fr`, hover updates `--seam` via CSS on each half, or a 10-line script maps pointer x to the variable.
Fallback: static 50/50 split; panels stack on mobile.

#### Typographic wall
The hero is nothing but text: a headline sized to fill the viewport, line-broken deliberately, with the color and one small line of supporting copy doing all the work.
Fits: agencies, writers, manifestos, anything with a strong sentence.
Build: heading with `font-size: clamp(3rem, 12vw, 14rem)`, `line-height: 0.9`, `text-wrap: balance`, tight letter-spacing; palette color as the ground.
Fallback: none needed; the clamp keeps it legible at every size.

#### Curtain reveal
Two solid panels in the accent color slide apart on first load to reveal the hero underneath, like stage curtains.
Fits: theaters, events, launches, restaurants with a dramatic tone.
Build: two fixed pseudo-elements on the hero group animated with `translateX` after a short delay, `animation-fill-mode: forwards`; keep it under 900ms.
Fallback: panels are skipped entirely under reduced motion, and only play once per session (`sessionStorage`).

#### Keyhole hero
The hero image is seen through a shape (circle, arch, letterform) that expands to full bleed as the visitor scrolls.
Fits: photographers, travel, architecture, wellness.
Build: cover block with `clip-path: circle(20% at 50% 50%)` animated to `circle(100%)` on a `view()` timeline; the shape can be `inset(... round ...)` for an arch.
Fallback: static full-bleed image when scroll timelines are unsupported or motion is reduced.

#### Marquee headline
A giant single-line headline scrolls continuously across the full viewport width as the hero, repeating the brand promise; thinner marquee bands can echo it between sections.
Fits: shops, festivals, food, streetwear, anything with energy.
Build: a group with `overflow: hidden` containing the paragraph duplicated twice inside a flex track animated with `translateX(-50%)`; pause on hover; bands alternate direction.
Fallback: marquee stops and shows a single centered line under reduced motion.

#### Stacked posters
Three or four rotated, overlapping cards fan out across the hero like posters pinned on a wall, each one a different palette color.
Fits: events, magazines, creative studios, musicians.
Build: absolutely positioned groups with `rotate()` and `translate()` per card, `box-shadow` for depth, top card carries the headline.
Fallback: cards become a straight vertical stack on narrow screens.

#### Letterbox cinema
An ultra-wide hero cropped with dark bars top and bottom; the title slides in from the right like a film credit.
Fits: filmmakers, agencies, luxury, storytelling brands.
Build: cover block with `aspect-ratio: 2.39 / 1` inside a dark full-bleed group; heading animated with `translateX` and `letter-spacing` easing in.
Fallback: aspect ratio relaxes to `16 / 9` on mobile; no slide under reduced motion.

#### Giant clock
The hero is a clock face filling the viewport; the hands show the real time, and the twelve hour markers are the navigation.
Fits: watchmakers, bars, coworking spaces, event venues, anything built around hours.
Build: a circular group with twelve absolutely positioned links rotated around the center (`rotate(n*30deg) translateY(-42%) rotate(-n*30deg)`), hands as thin groups rotated by a 5-line script from the current time.
Fallback: hands static at the load time; markers become a list on mobile.

#### Lenticular hero
The hero image changes as the pointer moves across it, the way a lenticular print flips between two pictures when tilted.
Fits: before/after services, seasonal businesses, product variants, photographers.
Build: two stacked images; the top one masked with `repeating-linear-gradient` stripes whose `mask-position` follows pointer x via a variable; at the extremes only one image shows.
Fallback: stripes split 50/50 on touch; crossfade on tap.

#### Magazine cover
The home page is a magazine cover: masthead, issue number and date, cover lines pointing at the sections, a barcode, and the hero image behind everything.
Fits: writers, fashion, salons, lifestyle brands, agencies with a voice.
Build: cover block with a huge masthead heading, cover lines as absolutely positioned link groups in condensed uppercase, barcode from a `repeating-linear-gradient`, issue date from a 3-line script.
Fallback: cover lines stack under the masthead on mobile.

### Scroll storytelling

#### Growing artifact
A single illustrated object (plant, building, product, logo) sits pinned beside the content and grows or unfolds as the visitor scrolls the story.
Fits: gardens, sustainability, product journeys, "how we grew" pages.
Build: sticky column holding an inline SVG; stages toggled by `view()` timelines on paths (`scale`, `stroke-dashoffset`) or an IntersectionObserver that adds `is-stage-2`, `is-stage-3` classes.
Fallback: artifact shown fully grown, static, above the content on mobile.

#### Drawn path
A line (route, river, thread) drawn in SVG follows the content, its stroke revealing itself as the visitor scrolls past each stop.
Fits: travel, timelines, delivery services, campus tours.
Build: SVG path with `stroke-dasharray` equal to its length and `stroke-dashoffset` animated by a `scroll()` timeline; stops are absolutely positioned groups.
Fallback: fully drawn path, static.

#### Horizontal chapter rail
One pinned section scrolls sideways through a row of panels while the page scroll stays vertical.
Fits: galleries, product lineups, team introductions.
Build: tall wrapper (`height: 300vh`) with a sticky track; `translateX` driven by a `scroll()` timeline on the wrapper.
Fallback: track becomes a normal horizontal scroll-snap carousel on mobile or without timeline support.

#### Layered landscape
Three or four flat illustrated layers (sky, hills, foreground) move at different speeds behind the hero content.
Fits: outdoors, tourism, children's brands, farms.
Build: absolutely positioned inline SVG layers, each with a `scroll()` timeline translating by a different distance; content sits on the front layer.
Fallback: layers flattened into one static image.

#### Scrubbed sequence
A pinned illustration steps through a dozen states as the visitor scrolls: a product turning, a logo assembling, a dish being plated.
Fits: product launches, makers, food, process explainers.
Build: inline SVG with twelve `<g>` frames; a `scroll()` timeline on the wrapper drives a `steps(12)` animation on a `--frame` variable, and each frame shows when `--frame` matches (or an IntersectionObserver over twelve sentinel divs).
Fallback: the final frame shown static.

#### Day to night
The page begins at dawn and ends at night: the sky gradient darkens as the visitor scrolls, stars fade in, and the footer is midnight.
Fits: hotels, cafés open late, event venues, wellness.
Build: fixed background gradient whose stops are variables animated on a `scroll()` timeline over the page; a stars layer (`radial-gradient` dots) fades in past 60%.
Fallback: static dusk gradient.

#### Unboxing
A box in the hero opens as the visitor scrolls: lid lifts, flaps fold back, the product rises out.
Fits: product launches, subscription boxes, gifts, packaging designers.
Build: an SVG box in a sticky hero, lid and flaps as groups with `rotateX` on `view()` timelines, product group with `translateY`.
Fallback: open box with product shown, static.

#### Elevator
The page is a building in cross-section; an elevator car moves between floors as the visitor scrolls, and each floor is a section.
Fits: hotels, agencies with departments, coworking spaces, multi-service firms.
Build: sticky left column with an SVG shaft; the car's `translateY` follows a `scroll()` timeline; floors are full-height groups on the right.
Fallback: shaft hidden on mobile; floors stack.

#### Satellite to street
Scrolling zooms from a satellite view of the region, through the city, down the street, to the shop front: each layer scales up and hands off to the next.
Fits: local businesses, real estate, tourism, delivery services, city guides.
Build: four stacked inline SVG layers in a sticky hero, each scaling from `1` to `8` with opacity on consecutive `view()` timelines; the last layer is the hero content.
Fallback: the street-level layer shown, static.

#### Time-lapse build
The product or building assembles piece by piece as the visitor scrolls, like a construction time-lapse: foundation, frame, walls, roof, sign.
Fits: builders, architects, furniture makers, hardware, anything assembled.
Build: inline SVG with each piece as a group that slides into place (`translateY(-40px)` to `0`, opacity) on its own `view()` timeline, stagger by scroll position; labels attach as pieces land.
Fallback: the finished object, static.

#### Cross-section descent
The page is a vertical cross-section, and scrolling descends through its layers: soil strata, ocean depths, a layer cake, the inside of a product.
Fits: geology, wineries, bakeries, diving schools, engineering, layered products.
Build: full-height sections each a layer with its own palette tint and a wavy SVG boundary, a fixed depth gauge on the side that reads the current layer via IntersectionObserver.
Fallback: gauge hidden on mobile.

#### Storm front
Weather rolls across the page as the visitor scrolls: clouds gather over the hero, rain streaks the middle sections, and the sky clears by the footer.
Fits: outdoor gear, roofers, insurance, farms, weather-related services, dramatic brands.
Build: fixed cloud layer (blurred `radial-gradient` shapes) translating and darkening on a `scroll()` timeline, a rain layer of animated spans that fades in and out over the middle of the page, palette brightening at the end.
Fallback: static overcast sky under reduced motion.

#### Exploded diagram
A product sits assembled in the hero; scrolling pulls its parts apart into an exploded view, and labels attach to each part as it separates.
Fits: hardware, bikes, audio, furniture, cosmetics, anything with parts worth naming.
Build: inline SVG parts as groups translating outward on `view()` timelines, label groups with leader lines (`stroke-dashoffset` draw) fading in as their part settles.
Fallback: exploded view shown static with labels.

### The site is an object

#### Receipt menu
The menu is a printed till receipt: monospace type, dashed tear lines, item and price columns, a subtotal, and a thermal-paper texture.
Fits: cafés, food trucks, bars, small restaurants.
Build: narrow centered group with a monospace font from `theme.json`, `border-top: 2px dashed`, `::after` zigzag edge via `clip-path`, faint noise overlay; each item a two-column row.
Fallback: none needed; the narrow column already fits mobile.

#### Film strip
The portfolio is a horizontal 35mm strip with sprocket holes; each frame is a project, and scrolling advances the strip.
Fits: photographers, filmmakers, motion studios.
Build: a horizontally scrolling flex track with `scroll-snap`, sprocket holes as repeating `radial-gradient` borders top and bottom, frame numbers in a small monospace label.
Fallback: strip becomes a vertical column on mobile.

#### Passport
The about page is a passport: a cover, a photo page with details, and visa stamps for milestones or clients that stamp in as the visitor scrolls.
Fits: travel agents, consultants, expats, international brands.
Build: pages as groups with rounded corners and a guilloche `repeating-radial-gradient`; stamps are rotated groups with `border: 3px double` and a `scale(1.4)` to `1` `view()` animation.
Fallback: stamps already applied.

#### Menu board
Services or products on a diner letter board: black felt with a ridged texture, white plastic letters, prices right-aligned with dot leaders, one item marked sold out.
Fits: diners, barbers, print shops, repair services.
Build: dark group with `repeating-linear-gradient` ridges, a condensed uppercase font, rows using `display: flex` with a dotted `::after` leader, `text-decoration: line-through` on the sold-out item.
Fallback: none needed.

#### Trading cards
The team or products are collectible cards with a frame, a rarity color, stats, and a holographic sheen on hover; the card flips to reveal the back.
Fits: agencies, sports clubs, game studios, product ranges.
Build: cards in a grid with `perspective`, inner group `rotateY(180deg)` on hover/focus; front and back as absolutely positioned groups with `backface-visibility: hidden`; sheen via a moving `linear-gradient` overlay.
Fallback: tap flips on touch; static cards under reduced motion.

#### Ticket stub
Pricing plans are perforated ticket stubs; each plan has a serial number, a seat class, and a stub that tears off on hover with the price.
Fits: events, venues, tours, classes, memberships.
Build: plan cards with a vertical dashed `border` and half-circle notches via `radial-gradient` masks; the stub group translates and rotates a few degrees on hover.
Fallback: static stubs.

#### Newspaper front page
The home page is a broadsheet: masthead, edition date and volume, a lead story with columns, sidebars, and "continued on page…" links to inner pages.
Fits: writers, journalists, local news, heritage brands, breweries.
Build: serif type scale, `column-count` on the lead story, hairline rules between sections, a masthead group with the current date from a 3-line script.
Fallback: columns collapse to one below 782px.

#### Terminal
The site reads like a terminal: a prompt, typed commands that reveal each section, a blinking cursor, and monospace everything.
Fits: developers, dev tools, security firms, hacker-adjacent brands.
Build: monospace font from `theme.json`, sections prefixed with a `::before` prompt (`$ about`), a `steps()` typing animation on the command line as it enters view, dark palette with one phosphor accent.
Fallback: commands shown fully typed.

#### Museum wall
Work is hung on a museum wall: framed pieces at eye level, small placards with title, year, and medium, a wall color, and a bench-height spacing rhythm.
Fits: artists, galleries, photographers, design studios.
Build: images with a thick `border` and inner `box-shadow` mat, placards as small groups with a serif italic title and a monospace caption, generous horizontal padding.
Fallback: none needed.

#### Boarding pass
The hero is a boarding pass: name, destination, gate, seat, a barcode, and a tear-off stub; each section is a leg of the journey.
Fits: travel agencies, tour operators, relocation services, airlines-adjacent brands.
Build: two-part group with a dashed divider and notches, uppercase monospace labels, barcode from a `repeating-linear-gradient` with varied stripe widths.
Fallback: parts stack on mobile.

#### Vinyl sleeve
The hero is a record sleeve; on hover the disc slides partly out, and the tracklist on the back is the site navigation.
Fits: musicians, labels, record shops, podcasts.
Build: square group for the sleeve, a circular group with `repeating-radial-gradient` grooves behind it translated on hover; tracklist as a numbered navigation block.
Fallback: disc shown half out, static.

#### Desk scene
The home page is a top-down desk: a notebook, a coffee cup, a phone, a camera, each an illustrated object that links to a page and lifts on hover.
Fits: freelancers, studios, writers, coaches.
Build: inline SVG objects positioned on a wood or paper textured group, each wrapped in a link with `translateY(-6px)` and a deeper shadow on hover; labels appear on hover.
Fallback: objects become a list with labels on mobile.

#### Envelope
The page opens as an envelope: the flap folds up, and the letter slides out carrying the hero message.
Fits: invitations, weddings, event announcements, personal letters, stationery brands.
Build: envelope group with a triangular flap (`clip-path`) rotated with `rotateX` from `perspective`, letter group translated up after the flap; plays once per session.
Fallback: the letter shown open, static.

#### Field notebook
The site is a ruled field notebook: margin notes, taped-in photos, small sketches, a date stamp on each entry.
Fits: outdoors guides, researchers, naturalists, travel writers, farms.
Build: `repeating-linear-gradient` rules on the content group, a red margin line, images with tape strips (`::before` translucent accent), a handwriting-style font for notes.
Fallback: none needed.

#### Departures board
The hero is an airport departures board: rows of split-flap letters that flip into place to spell the headline and the section names, with a clock and a "now boarding" row.
Fits: travel, logistics, event schedules, coworking spaces, anything with a timetable.
Build: each letter a small dark tile with a horizontal seam (`::after` hairline); flipping via a `rotateX` keyframe under `perspective` with per-tile delay, running through a few characters before settling; rows are links.
Fallback: letters shown settled under reduced motion.

#### Vending machine
Products sit in a lit vending machine; pressing a code makes the coil turn, the item drop to the tray, and its details appear.
Fits: snack brands, drinks, small product shops, merch, playful studios.
Build: a grid of product groups behind a glass gradient, a keypad of buttons, a 30-line script that animates the chosen item (`translateY` fall with a bounce keyframe) into a tray group and swaps the details.
Fallback: products become a plain grid on mobile.

#### Subway map
The site is a transit map: colored lines are sections, stations are pages, and the visitor "rides" between them with a train marker sliding along the line.
Fits: agencies with several services, city guides, universities, transit-adjacent brands, large sites.
Build: inline SVG with thick rounded polylines per palette color, station circles as links, a small train circle animated along the chosen line with `offset-path`; a legend lists the lines.
Fallback: lines become a list of sections with colored bullets on mobile.

#### Classified file
The site is a dossier: stamped "confidential", paper-clipped pages, and redacted bars over key words that lift on hover to reveal them.
Fits: security firms, investigators, escape rooms, thriller authors, launches with secrets.
Build: manila-tinted page groups with a rotated stamp `::before`, redactions as spans with a black `background` and `color: transparent` transitioning to visible on hover/focus, a paper-clip SVG.
Fallback: redactions lift on tap; a "declassify all" button reveals everything for accessibility.

#### Seed packet
The hero is a seed packet: an illustrated front with the variety name, and a back with planting instructions, sowing months, and a tear strip that opens it.
Fits: nurseries, farms, gardeners, florists, sustainability projects.
Build: a card group with a scalloped top via `radial-gradient` mask, front and back groups flipped with `rotateY` on a toggle, a months strip as twelve small boxes with the sowing ones tinted.
Fallback: front and back shown as two stacked cards.

### Playful interaction

#### Before and after slider
Two images sit on top of each other with a drag handle that reveals one or the other.
Fits: renovations, retouching, cleaning services, landscaping, dentists.
Build: a group with two stacked images, the top one clipped with `clip-path: inset(0 var(--cut) 0 0)`; a native `<input type="range">` overlaid at full width writes `--cut`.
Fallback: the range input works with keyboard and touch already.

#### Scratch-off
The hero message is hidden under a scratch layer; moving the pointer over it scratches through.
Fits: promotions, lotteries, launches, playful brands.
Build: overlay group with a metallic gradient masked by an accumulating list of `radial-gradient` circles a small script appends to `mask-image` from pointer positions; a "reveal all" button for accessibility.
Fallback: message shown directly on touch and under reduced motion.

#### Draggable stickers
The hero is covered in stickers visitors can drag around and rearrange; a "reset" link puts them back.
Fits: kids' brands, creative studios, festivals, snack brands.
Build: sticker groups with `position: absolute`, a 25-line pointer-events script updating `translate()`, `cursor: grab`.
Fallback: stickers static on touch; still draggable with mouse.

#### Service dial
A large rotating dial selects a service; turning it swaps the description and image beside it.
Fits: agencies with a few clear services, clinics, consultants.
Build: radio inputs styled as a circular dial with labels around the rim; `:checked` rotates the dial pointer (`rotate(var(--angle))`) and shows the matching panel.
Fallback: the radios remain keyboard-operable; panels stack on mobile.

#### Scroll pet
A small illustrated creature walks along the bottom edge as the visitor scrolls, turning around when the direction changes.
Fits: pet services, kids' brands, gardens, playful personal sites.
Build: fixed SVG at the bottom, `translateX` mapped to scroll progress by a script, `scaleX(-1)` on direction change, a two-frame walk cycle via `steps(2)`.
Fallback: hidden under reduced motion and on narrow screens.

#### Palette remix
A "remix" button reshuffles which palette color plays which role (ground, ink, accent), giving a new look with each press while staying on brand.
Fits: design studios, brands with a rich palette, creative personal sites.
Build: a small script cycles through three or four predefined role mappings by setting classes on `body`; every surface uses role variables mapped from `theme.json` slugs.
Fallback: none needed.

#### Mood picker
The visitor chooses a mood (calm, bold, playful) from chips at the top, and the site re-themes its palette, type scale, and motion to match.
Fits: agencies, personal sites, wellness, products with several audiences.
Build: three `body` classes with palette and `--motion-scale` overrides; chips are buttons storing the choice in `localStorage`.
Fallback: the default mood applies without a choice.

#### Stamp collector
Visiting each section stamps a badge into a tray at the bottom; complete the set to unlock a message or discount code.
Fits: tours, museums, campuses, product tours, loyalty-driven shops.
Build: IntersectionObserver adds `is-stamped` to badges in a fixed tray; a `scale(1.6)` to `1` keyframe on stamp; the final state in `sessionStorage`.
Fallback: tray hidden; badges shown inline on mobile.

#### Gravity drop
Clicking the hero makes its letters, shapes, or products lose their footing and tumble to the bottom of the viewport, piling up; a second click puts them back.
Fits: playful studios, toy brands, snack brands, kids' sites, anything with a sense of humor.
Build: hero children absolutely positioned; a class toggled by a click adds a `translateY(calc(100vh - var(--h)))` and random `rotate()` per element with staggered `transition-delay` and a bounce easing.
Fallback: nothing happens under reduced motion; a plain hero.

#### Slot machine
Three reels spin and stop on a combination: a dish, a drink, a dessert; a service, a timeline, a price; pull the lever to play again.
Fits: restaurants, bars, agencies with packages, gift shops, event planners.
Build: three vertical strips of items inside `overflow: hidden` windows, a 30-line script that animates `translateY` with easing to a random item per reel and delays each stop; a lever button.
Fallback: the three items shown as a plain list.

#### Fortune draw
A fanned deck of cards invites the visitor to pick one; it flips to reveal a product, a tip, a quote, or a menu suggestion.
Fits: tarot-adjacent brands, bookshops, cafés, coaches, wellness, gift shops.
Build: cards fanned with incremental `rotate()`, a chosen card translates to the center and flips (`rotateY`) via a class; contents pre-written in the pattern; "draw again" reshuffles.
Fallback: cards shown in a grid, tap to flip.

#### Choose your path
The about page is a branching story: each choice the visitor makes reveals a different next section, and the ending is the call to action that fits their path.
Fits: coaches, agencies with distinct audiences, schools, games, product finders.
Build: sections hidden until a link with a `data-path` is clicked; a 20-line script reveals the matching next section and scrolls to it; paths converge on a final section.
Fallback: all sections shown in order without the script.

#### Draw on it
The pointer draws a line on the hero as it moves, so every visitor leaves a scribble over the headline; it fades or clears on reload.
Fits: illustrators, kids' brands, art schools, stationery, playful personal sites.
Build: an absolutely positioned inline SVG over the hero; a 20-line script appends points to a `<path>` `d` attribute on pointer move with a palette stroke; a clear button.
Fallback: nothing drawn on touch scroll; a static hero.

### 3D & depth

#### Perspective floor
A grid that recedes toward a horizon, giving the page a 3D room feel without any 3D library.
Fits: tech, games, music, retro-future brands.
Build: a fixed pseudo-element with `background-image: repeating-linear-gradient` lines, `transform: perspective(60vh) rotateX(60deg)`, optional slow `background-position` animation.
Fallback: static grid; animation off under reduced motion.

#### Rotating cube
The hero is a cube; each face is a section, and the navigation rotates it to the chosen face.
Fits: agencies with four services, product with four features, portfolios.
Build: a `perspective` wrapper with a `transform-style: preserve-3d` group; faces absolutely positioned with `rotateY(n*90deg) translateZ(...)`; radio inputs set the cube's rotation.
Fallback: faces stack as sections on mobile and under reduced motion.

#### Paper fold
The hero opens like a folded brochure on load: panels unfold from the center in 3D.
Fits: print designers, invitations, tourism, brochure-style businesses.
Build: three panel groups under `perspective`, outer panels `rotateY(±90deg)` animating to `0` with `transform-origin` at the fold; plays once per session.
Fallback: unfolded panels shown, static.

#### Isometric town
The home page is an isometric town where each building is a page; hovering a building lifts it and shows its label.
Fits: coworking spaces, campuses, festivals, local guides, agencies.
Build: inline SVG buildings as links inside a scene group, `translateY(-8px)` and a longer shadow on hover; labels as absolutely positioned groups.
Fallback: buildings become a list on mobile.

#### Pointer parallax layers
Hero layers sit at different depths and shift against each other as the pointer moves, giving a subtle window-into-a-scene effect.
Fits: product launches, games, tech, illustrated brands.
Build: `perspective` on the hero, inner layers with `translateZ` depths; a 10-line script writes pointer offsets to `--rx`/`--ry` used in `rotateX`/`rotateY`.
Fallback: static on touch.

#### Cover flow
A row of images arranged in 3D, side items angled away and the center item facing forward; scrolling or arrows move the row.
Fits: galleries, product ranges, albums, books.
Build: a flex track under `perspective` with items `rotateY(±45deg)`; a scroll-snap track drives which item is `.is-center` via IntersectionObserver.
Fallback: plain horizontal scroll-snap carousel.

#### Hallway
Sections appear as doorways receding down a hallway; scrolling walks through them, each one growing to fill the viewport before passing by.
Fits: museums, agencies, storytelling, event programs.
Build: sticky viewport-sized stage; sections scale from `0.4` to `1.2` with opacity on individual `view()` timelines, stacked at the center.
Fallback: normal vertical flow.

#### Pop-up book
Each section is a page of a pop-up book: as it scrolls into view, layered paper cut-outs rise from the page fold in 3D.
Fits: children's brands, bookshops, theaters, storytellers, illustrators.
Build: sections under `perspective` with three or four cut-out groups whose `rotateX(90deg)` at the fold animates to `0` on `view()` timelines; layered `translateZ` depths.
Fallback: cut-outs shown standing, static.

#### Turnaround room
The hero is a room the visitor can turn around in: panels arranged in a cylinder, dragged or scrolled to look at each wall.
Fits: interiors, galleries, hotels, showrooms, escape rooms.
Build: eight panel groups under `perspective` with `rotateY(n*45deg) translateZ(r)`; a wrapper rotates by pointer drag or arrow keys via a 20-line script.
Fallback: panels become a horizontal scroll-snap row on mobile.

#### Shelf of boxes
Products sit as 3D boxes on a shelf; hovering pulls one forward and turns it to show the side label.
Fits: shops, tea and coffee brands, cosmetics, board games, books.
Build: each product a `preserve-3d` group with front and side faces (`rotateY(90deg)` side), shelf as a gradient plank; hover applies `translateZ(40px) rotateY(-25deg)`.
Fallback: front faces only on touch.

#### Drawers
Sections are the drawers of a cabinet; clicking a drawer front slides it out in 3D and shows the contents inside.
Fits: archives, workshops, apothecaries, tailors, collectors, agencies with a "toolbox".
Build: drawer fronts as buttons stacked in a cabinet group; the open one translates on the z-axis (`translateZ` under `perspective`) with its content group revealed beneath; one open at a time.
Fallback: drawers become an accordion.

## System

An idea that runs through every page, so inner pages feel designed rather than templated.

### Backgrounds & atmosphere

#### Halftone field
A dot-matrix pattern whose dot size changes across the page or with scroll, like a print screen.
Fits: comics, print shops, retro brands, magazines.
Build: `radial-gradient` dots on a repeating background sized with a `--dot` variable; a `scroll()` timeline or section variable changes `--dot`.
Fallback: fixed dot size.

#### Blueprint sheet
A fine grid with coordinate labels along the edges, so the site reads like a technical drawing.
Fits: architects, engineers, makers, hardware.
Build: page background from two `repeating-linear-gradient`s; edge labels are small fixed groups with `writing-mode: vertical-rl`, monospace font.
Fallback: labels hidden on mobile.

#### Isometric tiles
A repeating isometric cube pattern in two palette tints as the site's ground.
Fits: logistics, construction, software infrastructure, toys.
Build: an inline SVG tile (three rhombuses) as a repeating `background-image` on `body` or the hero; slow `background-position` drift.
Fallback: static.

#### Scanlines
Thin horizontal lines and a faint flicker over dark surfaces evoke a CRT screen.
Fits: retro tech, arcades, music, streetwear.
Build: fixed overlay with `repeating-linear-gradient` at 3px and a very slow opacity keyframe; `pointer-events: none`.
Fallback: flicker off under reduced motion.

#### Contour lines
Topographic contour lines wander across the background in a single palette tint, slowly shifting.
Fits: outdoors, cartography, wineries, geology, hiking.
Build: inline SVG of a few nested wobbly paths as a fixed background; a `scroll()` timeline translates it slightly for depth.
Fallback: static.

#### Living wallpaper
A wallpaper of tiny icons drawn from the business (croissants, wrenches, leaves, records) tiles the background and drifts very slowly.
Fits: bakeries, repair shops, florists, record stores, any brand with an obvious motif.
Build: one inline SVG tile with four to six small icons in a palette tint as a repeating `background-image`, 60-second `background-position` keyframe.
Fallback: static tile.

#### Window light
A soft, window-shaped patch of light lies across the page and drifts slowly, like afternoon sun moving across a room.
Fits: interiors, cafés, wellness, photographers, homes.
Build: fixed pseudo-element with a `linear-gradient` window shape (two panes via `mask`), `filter: blur(40px)`, low opacity, 90-second `translate` and `skew` keyframe.
Fallback: static patch.

#### Weathered wall
Every section is a different wall: plaster with cracks, peeling paint, a brick patch, old posters half torn off, and the content is pasted on top.
Fits: street food, music venues, vintage shops, skate brands, urban studios.
Build: section backgrounds from layered `feTurbulence` SVG textures in palette tints, crack paths as thin SVG strokes, poster scraps as rotated groups with torn `mask-image` edges.
Fallback: none needed.

#### Constellations
The night-sky background carries constellations shaped like the brand's initials or its objects, and the lines between stars draw in as the visitor scrolls.
Fits: astronomy, wellness, night venues, wineries, storytellers, brands with a guiding-star story.
Build: fixed inline SVG with star circles and polyline constellations, `stroke-dashoffset` driven by a `scroll()` timeline, a twinkle keyframe on a few stars.
Fallback: constellations fully drawn, static.

### Typography

#### Weight on scroll
Headings use a variable font whose weight thickens as the section scrolls into the center of the viewport.
Fits: type-driven brands, fashion, editorial.
Build: variable font in `theme.json` `typography.fontFamilies` with `fontFace`, `font-variation-settings: 'wght' var(--w)` driven by a `view()` timeline.
Fallback: fixed weight.

#### Vertical labels
Section titles run vertically along the left edge, like spine labels, leaving the content column clean.
Fits: architecture, galleries, editorial, minimal brands.
Build: heading with `writing-mode: vertical-rl; transform: rotate(180deg)` inside a two-column group with a narrow first column.
Fallback: labels turn horizontal above the content on mobile.

#### Text around a shape
Body copy flows around a circular or blob-shaped image, magazine style.
Fits: food, biographies, crafts, editorial.
Build: image block floated with `shape-outside: circle()` (or `shape-outside: url()` on the same image) inside a media-text group.
Fallback: image stacks above the text on mobile.

#### Ransom note
Headlines are set like a ransom note: each word in a different cut-out style, rotated slightly, on its own paper scrap.
Fits: zines, punk brands, activist groups, streetwear, kids' parties.
Build: words wrapped in spans with alternating `font-family`, `background`, `rotate()`, and `padding` from a small set of classes; two or three fonts registered in `theme.json`.
Fallback: none needed.

#### Dictionary entries
Section headings are styled like dictionary entries: the word, its pronunciation, a part of speech in italics, and a numbered definition.
Fits: writers, consultants, educators, brands built on a single word.
Build: heading pattern with a serif word, a monospace pronunciation span, italic part of speech, and a numbered paragraph indented beneath.
Fallback: none needed.

#### Baseline rules
Every text block sits on visible ruled lines, like a notebook or a ledger, and the line spacing across the site snaps to that rule.
Fits: accountants, schools, stationery, writers, planners.
Build: `repeating-linear-gradient` rules on content groups sized to the `--wp--custom--line-height` value, all font sizes chosen as multiples of it in `theme.json`.
Fallback: none needed.

#### Proofreader's marks
Every heading carries editor's marks: a word struck through with a better one inserted above a caret, a "stet" in the margin, a circled typo; the copy reads as a draft being improved.
Fits: editors, copywriters, publishers, translators, agencies that sell rigor.
Build: spans with `text-decoration: line-through` in a red tint, inserted words absolutely positioned above with a `^` caret `::before`, margin notes in a handwriting font via a two-column group.
Fallback: marks stay inline; margin notes drop below on mobile.

#### Subtitle bars
Every heading is followed by a film-style subtitle bar, and long copy appears as timed captions that advance as the visitor scrolls, two lines at a time.
Fits: filmmakers, translators, language schools, documentary makers, cinemas.
Build: subtitle paragraphs styled with a black translucent bar, white text, centered; captions revealed in sequence by `view()` timelines on each two-line span.
Fallback: all captions visible.

#### Concrete poetry
Headlines are arranged into the shape of their subject: "coffee" pours into a cup, "grow" climbs like a vine, the studio name forms its own building.
Fits: poets, cafés, gardens, architects, brands with a single strong noun.
Build: heading letters as spans placed on a CSS grid whose cells trace the shape (pre-composed in the pattern), sizes and rotations per letter class; the shape simplifies on mobile.
Fallback: a plain headline below 600px.

#### Stencil and spray
All headings are stencil letters with the bridges visible, sprayed on with overspray and drips; labels look like crate markings.
Fits: workshops, military surplus, breweries, street food, industrial brands.
Build: a stencil font registered in `theme.json`, a `feTurbulence` spray texture masked to the heading via `background-clip: text`, drips as small SVG shapes under some letters.
Fallback: stencil font without the spray texture.

#### Neon sign
Headings are neon tubes: glowing letters with a visible tube outline, a faint buzz-flicker on one letter, and sections that switch on as they scroll into view.
Fits: bars, diners, tattoo studios, music venues, late-night brands.
Build: rounded display font with layered `text-shadow` glows in the accent, `-webkit-text-stroke` for the tube, a flicker keyframe on one span, an `is-on` class from an IntersectionObserver.
Fallback: all signs on, no flicker under reduced motion.

### Layout & structure

#### Broken grid
Elements deliberately overlap and break the column grid: an image tucked under a heading, a caption hanging into the margin.
Fits: creative studios, fashion, editorial.
Build: constrained groups with negative `margin-block-start` and `margin-inline` on selected blocks, `z-index` layering, `alignwide` for the escaping elements.
Fallback: overlaps removed with a `max-width: 782px` rule that resets margins.

#### Single-screen site
The whole site lives inside one viewport; navigation swaps panels in place instead of scrolling.
Fits: restaurants, bars, small portfolios, event pages.
Build: `height: 100dvh` group with panels toggled by `:target` and CSS transitions; nav links point at panel ids.
Fallback: panels stack and scroll normally on short screens.

#### Fanned deck
Content cards are arranged as a fanned deck; hovering or tapping a card brings it to the front.
Fits: menus, tour packages, course lists.
Build: cards absolutely positioned with incremental `rotate()` around a low transform origin; `:hover`/`:focus-within` raises `z-index` and straightens.
Fallback: deck becomes a horizontal scroll-snap row on mobile.

#### Framed viewport
A thick colored frame surrounds the viewport at all times, and the site scrolls inside it.
Fits: galleries, print studios, fashion.
Build: fixed pseudo-elements on `body` (`inset: 0; border: 16px solid accent; pointer-events: none`) plus matching `padding` on the content.
Fallback: frame thins to 6px on mobile.

#### Spreadsheet
The whole site is laid out as a spreadsheet: column letters, row numbers, gridlines, and content in cells; a formula bar shows the current section.
Fits: accountants, data consultants, analysts, productivity tools, ironic creative studios.
Build: page group with a CSS grid and hairline `border`s, fixed row and column headers via `position: sticky`, monospace labels, a fixed top "formula bar" group updated by an IntersectionObserver.
Fallback: headers hidden on mobile; cells stack.

#### Margin notes
A single reading column with a wide outer margin that holds notes, asides, small images, and footnotes beside the text they refer to.
Fits: writers, researchers, consultants, long-form blogs, documentation.
Build: two-column group (`2fr 1fr`), notes as small groups floated into the margin with `margin-inline-start: 100%` tricks or grid placement; a hairline rule between.
Fallback: notes drop inline beneath their paragraph on mobile.

#### Poster pages
Every section is a full-viewport poster: one image, one headline, one line, and the page snaps from poster to poster.
Fits: campaigns, photographers, product lineups, event lineups.
Build: `scroll-snap-type: y mandatory` on the page, sections `height: 100dvh` with cover blocks and `scroll-snap-align: start`.
Fallback: snap disabled on short screens.

#### Two-persona flip
One switch flips the entire site between two versions: for clients and for talent, day menu and night menu, kids and parents; palette, copy, imagery, and order all change.
Fits: agencies, restaurants with two services, schools, dual-audience products, bars that become clubs.
Build: every block carries one of two persona classes; a `body` attribute toggled by the switch shows one set, with palette overrides per persona in `style.css`; choice stored in `localStorage`; a 400ms crossfade.
Fallback: the primary persona shows by default.

#### Printer's spread
Pages are laid out as a printer's imposed spread: crop marks in the corners, registration marks, a color bar along the edge, and a slug line with the job name and date.
Fits: print shops, graphic designers, publishers, letterpress studios, packaging.
Build: fixed corner groups with crop-mark `border`s, a registration-mark SVG, a color bar from palette swatches in a flex row, a monospace slug line; content sits inside the trim.
Fallback: marks hidden on mobile.

#### Annotated everything
Every element carries a hand-drawn annotation: arrows pointing at the button ("click this"), a circled price, a note beside the photo saying who took it.
Fits: teachers, indie makers, personal sites, friendly studios, product explainers.
Build: annotations as small groups in a handwriting font absolutely positioned beside their targets, arrows as short inline SVG paths with a wobbly stroke; a block style toggles them.
Fallback: annotations hidden on mobile.

### Imagery treatments

#### Scrapbook
Photos are slightly rotated with tape strips, shadows, and hand-written captions.
Fits: family businesses, crafts, travel diaries, schools.
Build: image block style with `rotate()`, `box-shadow`, and `::before` tape strips in a translucent accent; caption in a script font.
Fallback: rotation removed on mobile.

#### Torn edges
Images and color sections end in a torn-paper edge instead of a straight line.
Fits: zines, crafts, music, food trucks.
Build: `mask-image` with an inline SVG of a jagged path on the bottom edge of sections or images.
Fallback: none needed.

#### Depth stack
A single image is layered with two offset copies in palette tints behind it, and the layers separate slightly on hover.
Fits: design studios, print, music.
Build: image block style with `::before`/`::after` in palette colors offset by 8px and 16px; hover increases the offsets.
Fallback: static stack.

#### Portal frames
Images are shown through arched window frames with an inner border, like looking through a doorway.
Fits: interiors, boutiques, travel, weddings.
Build: image group with `border-radius: 50% 50% 0 0 / 30% 30% 0 0`, inner `outline` offset inward, generous padding in a palette tint.
Fallback: none needed.

#### Photo-booth strips
Images come in vertical strips of four frames with a white border, like a photo booth print, slightly tilted.
Fits: weddings, event photographers, bars, youth brands, schools.
Build: a group with four stacked images, white `padding` and `gap`, `rotate(-2deg)`, drop shadow; strips arranged in a flex row.
Fallback: strips stack, untilted, on mobile.

#### Risograph misregistration
Every image and heading is printed in two palette inks that don't quite line up: a slight offset between the layers, grainy texture, and colors that overlap into a third.
Fits: zines, indie publishers, studios, cafés, record labels, anything with a print heart.
Build: image block style stacking the image twice with `mix-blend-mode: multiply`, each tinted via a palette duotone preset and offset by 3px; headings via a `text-shadow` in the second ink offset by 2px; grain from a `feTurbulence` overlay.
Fallback: none needed.

#### Cyanotype
All photographs are cyanotypes: Prussian-blue and paper-white with soft brushed edges, like sun prints.
Fits: botanists, nurseries, coastal brands, printmakers, heritage studios.
Build: a duotone preset in `theme.json` (deep blue, off-white) applied to image and cover blocks by default, edges via a `mask-image` with a rough brush-shaped SVG.
Fallback: none needed.

#### Cut-out collage
Images are cut out with a rough white paper border and layered onto painted color fields, overlapping each other like a collage.
Fits: creative studios, fashion, magazines, food, kids' brands.
Build: image block style with a thick white `border`, a wobbly `clip-path: polygon(...)`, `rotate()` per image, layered in a group with negative margins over `feTurbulence`-textured color blocks.
Fallback: overlaps removed on mobile.

#### Postage stamps
Every image is a postage stamp: perforated edges, a denomination in the corner, the country or brand name along the edge, and a cancellation mark across one corner.
Fits: travel, letterpress, stationery, heritage brands, international businesses.
Build: image group with a `mask-image` of `radial-gradient` perforations along the edges, a small denomination paragraph, a rotated SVG cancellation of concentric wavy lines.
Fallback: none needed.

#### Contact sheet
Galleries are a photographer's contact sheet: a dark ground, frame numbers, film-edge markings, and a grease-pencil circle around the chosen frames.
Fits: photographers, studios, agencies, fashion, documentary makers.
Build: gallery block style on a black group with small monospace frame numbers, an orange edge-marking strip via `repeating-linear-gradient`, chosen frames with a hand-drawn SVG circle `::after`.
Fallback: none needed.

### Content metaphors

#### Chat-thread FAQ
Questions and answers are a chat conversation: questions as sent bubbles, answers as received bubbles with a typing indicator before each one appears.
Fits: support pages, clinics, consultants, apps, friendly service brands.
Build: alternating paragraph styles with bubble radii and palette tints, a three-dot `::before` typing indicator that hides via a `view()` timeline before the answer fades in.
Fallback: answers shown directly.

#### Text-message testimonials
Quotes are phone messages: bubbles with the sender's name, a timestamp, and a read receipt, grouped like a thread.
Fits: local services, tutors, trades, personal brands.
Build: quote block style with bubble shape, a small header line for name and time, `max-width: 70%` alternating alignment.
Fallback: none needed.

#### Recipe process
The process or service is written as a recipe: ingredients (what you bring), numbered steps, prep time, serves, and a difficulty rating.
Fits: cafés, workshops, consultants, onboarding pages, courses.
Build: a two-column pattern (ingredients list, numbered steps) with a header row of small labeled stats; serif for the title, small caps for labels.
Fallback: columns stack.

#### Comic strip
The story or about page is told in comic panels with captions and speech bubbles, appearing one panel at a time.
Fits: kids' brands, studios, founders' stories, games, schools.
Build: grid of bordered panels (`border: 3px solid`, uneven column widths), speech bubbles as groups with a `::after` tail, panels fade in on `view()` timelines.
Fallback: all panels visible; grid becomes one column on mobile.

#### Spec sheet
Services or products are presented as a technical spec sheet: a table of monospace labels and values, part numbers, tolerances, a revision date.
Fits: engineering, hardware, manufacturers, bike shops, audio.
Build: table block style with `border-collapse`, hairline rows, monospace labels in a muted tint, a header group with document number and revision.
Fallback: none needed.

#### Corkboard
Updates and posts are index cards pinned to a corkboard, slightly askew, with a colored pin and a hand-written date.
Fits: community groups, schools, cafés, clubs, personal blogs.
Build: query loop with post cards styled with `rotate()`, a `::before` pin circle, cork texture via `feTurbulence` on the container.
Fallback: cards straighten on mobile.

#### Playlist
Portfolio items or services are a playlist: track number, title, artist (the client), duration, and a play icon that expands the row.
Fits: musicians, podcasters, agencies, portfolios.
Build: rows as flex groups with monospace numbers and durations, a details block for the expanded row, hover tints the row.
Fallback: none needed.

#### Nutrition facts
Pricing or plans are a nutrition-facts label: serving size, the bold black rules, percentages of "daily value" for each feature, a fine-print ingredients list.
Fits: SaaS, gyms, meal services, memberships, health brands, agencies with packages.
Build: a narrow white group with heavy `border-bottom` rules of varied thickness, a condensed bold font, rows as flex groups with right-aligned percentages, ingredients as a small paragraph.
Fallback: none needed.

#### Assembly instructions
The process is a flat-pack assembly manual: numbered wordless diagrams, an exploded parts list with quantities, a "you will need" row of tools, and a warning triangle.
Fits: builders, onboarding pages, workshops, product setup, agencies that sell a process.
Build: steps as a grid of bordered panels with big step numbers, inline SVG line drawings in a single stroke color, a parts table with quantity badges.
Fallback: one column on mobile.

#### End credits
The team page rolls like film end credits: role on the left, name on the right, scrolling up automatically over a dark ground, with a "special thanks" section.
Fits: agencies, production companies, theaters, event teams, open-source projects.
Build: a two-column list inside a `height: 100dvh; overflow: hidden` group, translated upward by a slow linear keyframe that pauses on hover; serif or condensed uppercase.
Fallback: a static list under reduced motion.

#### Field guide
Products or services are field-guide entries: a Latin-style name, habitat, season, size, an illustration, and "often confused with" notes.
Fits: nurseries, breweries, cheesemongers, outdoors brands, naturalists, product ranges.
Build: entries as two-column groups with an italic scientific-name heading, small labeled rows, a season strip of twelve boxes, an inline SVG illustration.
Fallback: columns stack.

#### Patent drawing
The product is presented as a patent figure: a black line drawing, numbered callouts with leader lines, "FIG. 1", and a claims list beneath in numbered legal prose.
Fits: hardware, inventors, engineering firms, bike and audio brands, design-led products.
Build: inline SVG line drawing on cream paper, callout numbers as small circles with hairline leaders, a serif "claims" list with hanging numbers.
Fallback: none needed.

### Generative & personal

#### Name-seeded pattern
The background pattern is generated from the brand name: a hash decides which dots, lines, or shapes fill the grid, so no other site has it.
Fits: any brand, especially those without a logo yet.
Build: a 30-line script hashes the site title, writes an inline SVG pattern (positions and shapes from the hash bits) into a fixed background group; the same seed every visit.
Fallback: a static pattern in the theme assets when the script is absent.

#### Initials monogram
An SVG mark built from the brand's initials in geometric shapes is the hero mark, the section divider, and the favicon.
Fits: personal brands, boutiques, law firms, consultants, wedding sites.
Build: inline SVG with the letters drawn as circles, bars, and arcs in palette colors, reused via a pattern; scaled small as a separator block style.
Fallback: none needed.

#### Per-visit poster
The hero composition (shape positions, rotation, which palette color plays which role) is randomized within constraints on every visit.
Fits: creative studios, festivals, galleries, brands that want to feel alive.
Build: a 20-line script picks from a set of layouts and role mappings and sets classes and variables on the hero; every variant uses the same blocks.
Fallback: the default variant renders without the script.

#### ASCII hero
The headline or logo is rendered as a grid of characters in a monospace font, the way early terminals drew pictures.
Fits: developers, tech products, retro brands, hacker culture.
Build: a preformatted block with pre-generated ASCII art in a monospace font, `line-height: 1`, a palette accent; optional letter-by-letter reveal via `steps()`.
Fallback: none needed.

#### Color from title
Each page and post derives its accent color from a hash of its title, so the archive looks varied while every page stays systematic.
Fits: blogs, magazines, portfolios, agencies with many case studies.
Build: a 10-line script hashes the title into an index over the `theme.json` palette and sets `--accent` on the page; cards in query loops do the same.
Fallback: the default accent.

#### Brand tartan
A plaid woven from the palette colors is the brand's cloth, used on covers, dividers, and the footer.
Fits: heritage brands, outfitters, whisky, knitwear, Scottish or Nordic references.
Build: two layered `repeating-linear-gradient`s (horizontal and vertical stripes of palette colors) with `mix-blend-mode: multiply` on a group; scaled smaller for dividers.
Fallback: none needed.

#### Word-shaped cloud
The brand's key phrases are arranged to fill a shape (a circle, a leaf, the first letter of the name) as the hero graphic.
Fits: nonprofits, communities, schools, coaches.
Build: phrases as paragraphs placed in a CSS grid whose cells are hidden outside the shape using `clip-path` on the container; sizes vary by weight class.
Fallback: phrases become a simple list on mobile.

### Time & context

#### Changing seasons
A hero scene (tree, landscape, storefront) shifts through spring, summer, autumn, and winter as the visitor scrolls, or matches the current month on load.
Fits: farms, gardens, tourism, schools, seasonal shops.
Build: inline SVG scene with four CSS states toggled by a `season-*` class on the hero; a `scroll()` timeline or a 5-line script picks the class from the month.
Fallback: single season matching the current month, static.

#### Time-of-day palette
The palette and the hero sky shift between morning, day, evening, and night variants based on the visitor's clock.
Fits: cafés, hotels, wellness, travel, personal sites.
Build: four sets of palette overrides as `body.is-morning` etc. in `style.css` mapped from `theme.json` slugs, hero gradient stops as variables; a 6-line script sets the class from `Date().getHours()`, with a 2-second transition.
Fallback: the day palette as default.

#### Ambient weather
Light CSS particles (falling leaves, snow, rain streaks, pollen) drift over the hero, chosen by the current month.
Fits: outdoor brands, cafés, seasonal shops, tourism.
Build: a dozen absolutely positioned spans with randomized `animation-delay` and `left` values, keyframes per particle type; a class from the month picks the type.
Fallback: particles off under reduced motion and on mobile.

#### Shop-front sign
The header is a live shop front: a hanging sign that flips between OPEN and CLOSED on the real hours, today's date chalked beside it, and a note about what is happening right now ("the ovens are on").
Fits: bakeries, cafés, barbers, clinics, workshops, any place with a door.
Build: a two-sided sign group flipped with `rotateY` by a class from a 25-line script that reads hours from `data-` attributes in the business time zone via `Intl.DateTimeFormat`; date and message from the same script.
Fallback: hours listed plainly, sign showing OPEN.

#### Moon phase
The hero shows tonight's actual moon phase, and the palette darkens or brightens with it: new moon sites are near-black, full moon sites glow.
Fits: bars, night markets, wellness, astrology-adjacent brands, wineries, observatories.
Build: an SVG moon with a shadow circle offset by a 15-line script computing the phase from the date; `body` gets a `phase-*` class mapped to palette overrides.
Fallback: a full moon and the default palette.

## Detail

A small repeated delight: a cursor, a hover, a motion signature, the way navigation behaves.

### Cursor & hover

#### Cursor spotlight
A hidden layer (alternate image, message, texture, or grid) shows only inside a soft circle around the cursor.
Fits: mystery launches, portfolios, museums, dark-themed tech.
Build: top layer masked with `mask-image: radial-gradient(160px at var(--mx) var(--my), #000, transparent)`, variables set by a pointer script.
Fallback: hidden layer revealed on tap or fully shown on mobile.

#### Hover preview list
A plain list of projects or dishes; hovering an item makes its image float beside the cursor.
Fits: portfolios, restaurants, galleries.
Build: list items with a hidden image, positioned `fixed` and moved to the pointer by a script; `opacity` transition.
Fallback: images shown inline beneath each item on touch.

#### Magnifier lens
Hovering a product image shows a round magnified view at the cursor.
Fits: shops, jewelry, prints, watches.
Build: a fixed circle whose `background-image` is the same image at 250% size, positioned from pointer coordinates by a script.
Fallback: tap to open the full image.

#### Word flip links
Links show an alternate word on hover, rolling up like a split-flap board.
Fits: playful brands, agencies, personal sites.
Build: link with `data-alt`, `::after` holding the alternate text, `overflow: hidden` and a `translateY` swap on hover.
Fallback: static link text.

#### Per-item accent
Each card sets its own accent color; hovering tints its border, shadow, and button with that color.
Fits: multi-product shops, categories, team pages.
Build: cards carry `style="--accent: var(--wp--preset--color--...)"` via block styles; hover rules use `var(--accent)`.
Fallback: none needed.

#### Echo hover
Hovering an image briefly stacks two or three scaled copies behind it that settle back, like an echo.
Fits: music, events, streetwear.
Build: image block style with `::before`/`::after` copies of the same `background-image`, scaled and offset on hover with a short transition.
Fallback: no effect on touch.

#### Cursor as tool
The cursor is the trade's tool: a whisk for the bakery, a broom for the cleaners, a flashlight for the electrician, a pencil for the illustrator; it tilts slightly as it moves and "works" on hover over links.
Fits: any trade or craft with an iconic tool.
Build: `cursor: url(tool.svg) x y, auto` from a theme asset for the static version; for the tilt, a fixed SVG following the pointer via `requestAnimationFrame` with `rotate()` from movement direction, `cursor: none` only when `(pointer: fine)`.
Fallback: native cursor on touch and under reduced motion.

#### Trail
The cursor leaves a trail that belongs to the brand: pawprints for the vet, petals for the florist, footprints in sand for the beach hotel, sparks for the welder, fading out behind it.
Fits: pet services, florists, hotels, workshops, kids' brands.
Build: a 20-line script drops a small SVG element at the pointer every 120ms, alternating left/right for prints, each with a 1.5-second fade-and-scale keyframe then removed.
Fallback: no trail on touch or under reduced motion.

#### Peel corner
The page corner peels up on hover to reveal a message or a secondary palette beneath.
Fits: print shops, stationery, promotions, personal sites.
Build: a fixed corner group with a `linear-gradient` "back side", `clip-path` triangle growing on hover with a transition; the reveal is a link to a page.
Fallback: static small corner on touch.

### Motion signatures

#### Rotating badge
A circular text badge ("est. 2012 · handmade · local") rotates slowly in a corner of the hero.
Fits: bakeries, breweries, artisans, farms.
Build: inline SVG with `textPath` on a circle, `animation: spin 20s linear infinite`.
Fallback: static badge under reduced motion.

#### Light switch
A pull-cord or toggle in the header flips the entire site between its day and night palettes, with a short lamp-warming transition and a swinging cord.
Fits: interior designers, lighting brands, cafés, personal sites.
Build: a checkbox-styled button toggling `data-theme` on `html`; both palettes defined in `style.css` from `theme.json` slugs; `transition: background-color .4s, color .4s` on surfaces; a cord SVG with a pendulum keyframe on click; state stored in `localStorage`.
Fallback: none needed.

#### Rubber stamp
Buttons stamp down on click: the button presses in, an ink impression of its label appears slightly rotated and uneven beside it, then fades.
Fits: post offices, notaries, stationery, libraries, workshops, approval-flavored brands.
Build: `:active` scales the button to `0.94`; a 15-line script clones the label into a rotated span with `mix-blend-mode: multiply`, a rough `mask-image`, and a 1.2-second fade keyframe.
Fallback: the press-in only under reduced motion.

#### Hand-drawn underline
Links get a wobbly hand-drawn underline that draws itself in on hover, a different scribble on each link.
Fits: illustrators, teachers, indie makers, friendly studios.
Build: an inline SVG path under each link (three or four variants via block style classes), `stroke-dasharray` and `stroke-dashoffset` transitioning on hover; the current link stays drawn.
Fallback: standard underline on touch.

#### Filling object
The scroll progress indicator is a brand object that fills as the visitor reads: a coffee cup, a jar, a battery, a beer glass, a thermometer.
Fits: cafés, breweries, energy brands, nonprofits with a goal, long-form sites.
Build: a fixed inline SVG with a fill rectangle whose `height` is driven by a `scroll()` timeline over the page; a `clip-path` gives the object shape.
Fallback: hidden on mobile.

#### Printed confirmation
Submitting a form prints a receipt: a paper strip scrolls out from a slot with the details, a timestamp, and a "thank you" in dot-matrix type.
Fits: shops, cafés, bookings, event registrations, quirky studios.
Build: form success message styled as a narrow monospace strip with a torn bottom edge, `translateY(-100%)` to `0` keyframe from behind a slot group, timestamp from a 3-line script.
Fallback: the strip shown static.

#### Pond ripple
Every click anywhere on the page sends a ripple ring outward from the pointer, like a stone dropped in water.
Fits: spas, pools, wellness, aquariums, meditation, water brands.
Build: a 10-line script appends a fixed circle at the click point with a `scale(0)` to `scale(12)` and opacity keyframe over 900ms, removed on `animationend`; `pointer-events: none`.
Fallback: off under reduced motion.

### Navigation & transitions

#### Side rail
A narrow vertical rail on the left holds the logo and rotated links, leaving the full width for content.
Fits: architecture, galleries, editorial.
Build: header template part as a fixed 64px column; links with `writing-mode: vertical-rl`.
Fallback: rail becomes a top bar on mobile.

#### Menu with page previews
Hovering a menu link shows a preview image of that page beside the list.
Fits: agencies, magazines, restaurants.
Build: overlay menu with a preview column; each link sets `--preview` via `data-` attribute and a tiny script swaps the image.
Fallback: preview column hidden on mobile.

#### Page curl transitions
Navigating between pages turns the page: the old page curls away from a corner and the new one lies beneath it.
Fits: bookshops, publishers, writers, stationery, storytelling sites.
Build: `@view-transition { navigation: auto; }` in `style.css`, `::view-transition-old(root)` animated with a `clip-path` diagonal sweep plus a `rotate` and shadow to suggest the curl; `view-transition-name` on the header so it stays put.
Fallback: instant navigation where unsupported or under reduced motion.

#### Index landing
The home page is a numbered index of the site's pages, like a book's table of contents, each entry with a one-line summary.
Fits: writers, studios, consultancies, archives.
Build: home template listing pages as a numbered group with large numerals, titles, and summaries; hover reveals an arrow.
Fallback: none needed.

#### Command palette
Pressing `/` or clicking a search-shaped button opens a palette listing every page and section; typing filters it, Enter jumps.
Fits: developers, documentation, tools, dense sites.
Build: a `<dialog>` with an input and a list of anchor links, a 30-line script filtering by `includes()` and handling arrow keys.
Fallback: the button opens the list without filtering when the script is absent.

#### Folder tabs
Navigation is a row of manila folder tabs; the active page is the open folder and its content sits on the folder body.
Fits: accountants, archives, law firms, schools, retro offices.
Build: navigation links styled with a trapezoid `clip-path`, the current item joined to the content group with a matching background and no bottom border.
Fallback: tabs wrap to two rows on mobile.

#### Radial menu
Clicking the logo fans the navigation links out around it in a circle.
Fits: playful brands, studios, small sites with few pages.
Build: links absolutely positioned around the logo with `rotate(n*60deg) translate(120px) rotate(-n*60deg)`, `scale(0)` to `1` transition when a checkbox toggle is checked.
Fallback: standard menu on mobile.

#### Rotary dial
Navigation is a rotary telephone dial: each finger hole is a page, and dragging the dial around to the stop and releasing it "dials" the page.
Fits: retro brands, vintage shops, phone-adjacent businesses, playful studios, diners.
Build: a circular group with numbered holes as links rotated around the center; a 25-line pointer script rotates the dial with the drag, and releasing past the stop navigates; the dial springs back with a transition.
Fallback: holes work as plain links; standard menu on mobile.
