---
name: creative-direction
description: Expand a vague site brief into a rich content and structure plan. Infer site type, choose appropriate pages and sections, commit to a fitting design direction, and briefly tell the user what you're building — then build it without asking.
user-invokable: false
---

# Creative Direction

When building a new WordPress site from a brief or vague prompt, use this skill to expand the brief into a rich content plan before writing any files. The goal: a user who types "a site for a bar" gets a site as complete and functional as one described with a detailed spec — because you make the right assumptions for them.

## Step 0 — Gauge the Brief

Before expanding, read what the user gave you and pick the right mode:

| Signal | Mode |
|--------|------|
| Site type is clear, content is thin ("a site for a bar") | **Auto-expand** — proceed to Step 1 |
| Site type is ambiguous ("a site for my business") | **Ask one question** to resolve it, then proceed to Step 1 |
| User already described pages, sections, or copy | **Skip this skill** — build what they asked for |
| User said "minimal", "one page", or "just a placeholder" | **Skip this skill** |

**The one question rule**: if you need to ask, ask a single, specific question that resolves the ambiguity (e.g. *"What kind of business is this for?"*). Do not ask multiple questions. Once you have the answer, proceed.

## Step 1 — Detect the Site Type

From the site name and prompt, infer what kind of site this is. Use your judgment freely — the following are common patterns, not an exhaustive list:

- **Bar / Nightclub / Venue** — bar, club, lounge, pub, tavern, speakeasy, nightlife
- **Restaurant / Café / Bakery** — restaurant, café, bistro, diner, bakery, brunch, eatery
- **Coffee Shop** — coffee, roastery, espresso, specialty/third-wave café
- **Portfolio (Photo / Design / Art)** — photographer, designer, artist, illustrator, studio
- **Agency / Creative Studio** — agency, studio, consulting, branding, digital
- **SaaS / Tech Product** — app, software, platform, tool, saas, product
- **Fitness / Gym / Yoga** — gym, fitness, yoga, pilates, crossfit, wellness, studio
- **Salon / Spa / Beauty** — salon, spa, beauty, barbershop, nail, aesthetics
- **Non-profit / Cause** — foundation, charity, org, cause, community
- **Professional Services** — law, dental, medical, clinic, accounting, finance
- **Personal Blog / Magazine** — blog, journal, magazine, editorial

For anything not on this list, reason by analogy: what kind of site does this business actually need?

## Step 2 — Expand Into Pages and Sections

Based on the site type, decide which pages and home-page sections to create. **Do not default to a minimal one-page placeholder** when the type clearly warrants more. The examples below are starting points — treat them as inspiration, not prescriptions. Adapt freely based on the site name and any details the user gave.

### Bar / Nightclub / Venue
**Pages**: Home, Menu (drinks & food), Events, Gallery, Contact + Hours  
**Home sections**: hero (full-bleed, mood-setting), featured events teaser, menu highlight, gallery strip, reservation CTA  
**Forms**: reservation/book-a-table (Jetpack contact form), newsletter signup  
**Design signal**: dark & atmospheric; bold typography; energy

### Restaurant / Café / Bakery
**Pages**: Home, Menu, Reservations, Gallery, About, Contact  
**Home sections**: hero with signature dish, menu teaser, about/story, gallery, reservation CTA  
**Forms**: reservation form, contact form  
**Design signal**: warm, inviting; food-photography-driven; approachable

### Coffee Shop
**Pages**: Home, Menu, Our Story, Locations, Contact  
**Home sections**: hero, signature drinks highlight, story/craft section, locations map teaser, newsletter  
**Forms**: newsletter signup, contact  
**Design signal**: artisanal; hand-crafted feel; warm neutrals or bold brand color

### Portfolio (Photographer / Designer / Artist)
**Pages**: Home, Work/Portfolio (grid), About, Services, Contact  
**Home sections**: full-bleed hero work, selected projects grid, brief about, services teaser, contact CTA  
**Forms**: contact/inquiry form  
**Design signal**: let the work breathe; minimal chrome; bold typography for name/headline

### Agency / Creative Studio
**Pages**: Home, Services, Work/Case Studies, Team, About, Contact  
**Home sections**: hero value prop, services overview, selected work, team teaser, client logos, contact CTA  
**Forms**: project inquiry form, contact  
**Design signal**: confident; editorial; distinctive brand identity

### SaaS / Tech Product
**Pages**: Home (all-in-one landing), Pricing, About, Contact  
**Home sections**: hero + one-line value prop, key features (3-up or 4-up), how-it-works, testimonials/social proof, pricing teaser, FAQ, final CTA  
**Forms**: newsletter/waitlist signup, contact  
**Design signal**: clean, modern; strong CTA hierarchy; trust signals prominent

### Fitness / Gym / Yoga Studio
**Pages**: Home, Classes/Schedule, Memberships & Pricing, Trainers, About, Contact  
**Home sections**: hero (energy/motion), classes preview, membership tiers, trainer spotlight, testimonials, CTA  
**Forms**: class booking / free trial signup, contact  
**Design signal**: energetic or calm (match the discipline); strong photography

### Salon / Spa / Beauty
**Pages**: Home, Services & Pricing, Team, Gallery, Book Now, Contact  
**Home sections**: hero, services overview, team highlights, gallery strip, booking CTA  
**Forms**: booking/appointment form, contact  
**Design signal**: luxe or friendly; clean; beauty imagery

### Non-profit / Cause
**Pages**: Home, Mission/About, Programs, Team, Get Involved/Donate, Contact  
**Home sections**: mission statement hero, impact stats, programs overview, team, call to donate/volunteer  
**Forms**: donation CTA (link to external), volunteer/contact form  
**Design signal**: hopeful, trustworthy, human-centered

### Professional Services (Law / Medical / Dental / Accounting)
**Pages**: Home, Services, Team/Credentials, Testimonials, Contact  
**Home sections**: hero (credibility-first), services grid, team highlight, testimonials, contact CTA  
**Forms**: appointment / consultation request form  
**Design signal**: authoritative, clean, trustworthy; conservative palette

### Personal Blog / Magazine
**Pages**: Home (recent posts), About, Category archives, Contact  
**Home sections**: featured post hero, recent posts grid, about blurb, newsletter  
**Forms**: newsletter signup, contact  
**Design signal**: editorial; typography-driven; readable

## Step 3 — Pick a Design Direction

Commit to an aesthetic that genuinely fits the site name and type. Use the name as a creative brief — the right answer is different every time. Some examples of how a name can point to a direction:

- *"Boogie Bar"* → dark & moody; jazz/funk energy; amber + deep black; retro headlines
- *"Morning Light Bakery"* → warm, handcrafted; cream + terracotta; flowing serif display
- *"Apex Fitness"* → high-contrast; kinetic; strong sans-serif; black + electric accent
- *"Root Studio"* (yoga) → organic, grounded; earth tones; soft, breathing layout
- *"Hartley & Associates"* (law) → authoritative, minimal; navy + gold; refined serif

These are illustrations, not a template. Read the name. Do not default to safe/generic.

## Step 4 — Brief the User in ≤4 Lines

Before building, tell the user what you decided in 2–4 short lines:

> *"Building a 5-page site for Boogie Bar: Home, Menu, Events, Gallery, and Contact. Dark & moody aesthetic with jazz-inspired typography and an amber/black palette. Includes a reservations form and a newsletter signup."*

Then proceed immediately — **do not ask for approval**. Build it.

## What "Rich Content" Means

When generating page content, go beyond placeholder copy:

- **A bar**: write actual cocktail names and descriptions, real-sounding event nights ("Jazz Thursdays", "Trivia Night"), a gallery section
- **A bakery**: name actual pastries and breads; write a "baker's story" paragraph; include seasonal specials
- **A portfolio**: write a compelling headline and 3–5 project card stubs with realistic titles
- **A SaaS**: write feature names and one-liners, realistic pricing tiers, 2–3 testimonial quotes

Use the site name as context. Make it feel like a real site for that specific business, not a generic template.

## When to Skip This Skill

- User already provided detailed content (specific pages, copy, sections described)
- User explicitly said "keep it minimal", "one page", or "just a placeholder"
- Redesigning or updating an existing site
