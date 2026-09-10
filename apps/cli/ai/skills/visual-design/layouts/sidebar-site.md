---
title: "Sidebar site"
description: "A fixed column one-third wide holds the brand, the navigation, and one live detail such as opening hours or a short note; everything else lives in the remaining two-thirds and scrolls past it. The proportion never changes, so the site is recognizably asymmetric on every screen."
---
Build: a two-column group (`grid-template-columns: 1fr 2fr`); the sidebar column `position: sticky; top: 0; height: 100dvh` with its own background, so the page scrolls while the sidebar stays put — do not make the content column its own scroll container (`overflow-y: auto`), which breaks anchor links, scroll restoration, and mobile; header and footer parts live inside the sidebar, not above or below the content; sidebar links to sections scroll smoothly (`html { scroll-behavior: smooth }`, off under reduced motion) rather than jumping, and the link for the section in view is marked current via a small IntersectionObserver.
Fallback: sidebar becomes a top bar on mobile, the live detail moves to the footer.
