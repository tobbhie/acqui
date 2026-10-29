# Acqui landing page design QA

- Source visual truth: `C:\Users\LENOVO\.codex\generated_images\01a1840b-f33c-75a2-a7a1-1eeb05940f47\exec-4122cf6d-8be8-443e-bcb6-e6cbc487c39e.png`
- Implementation screenshot: `C:\Users\LENOVO\acqui\design-qa-implementation.png`
- Mobile screenshot: `C:\Users\LENOVO\acqui\design-qa-mobile.png`
- Side-by-side comparison: `C:\Users\LENOVO\acqui\design-qa-comparison.png`
- Desktop viewport: 1440 × 1024 CSS px, device scale 1
- Source pixels: 749 × 2098
- Implementation pixels: 1440 × 1024
- Normalization: implementation resized to 749 px wide; source cropped to the matching 533 px above-the-fold height; both placed in one 1498 × 533 comparison image.
- State: public landing page, light theme, top of page.

## Full-view comparison evidence

The implementation preserves the selected concept's editorial structure: restrained navigation with a primary get-started action, asymmetric hero copy and settlement illustration, a four-column capability rail, full-width section dividers, payment-flow cards, a network roadmap, three builder/operator columns, and a closing CTA. The hierarchy, warm white/navy palette, pale-blue product surfaces and green live state are consistent with the source.

## Focused region evidence

The above-the-fold hero was compared at equal normalized width. The final implementation uses a three-line headline, matching left/right proportions, authentic USDC and Arc icons, a readable settlement card and a capability rail in the first viewport. The source's decorative connector marks were intentionally omitted rather than approximated with CSS art. The source's Docs navigation item was also omitted because the existing product has no Docs route.

The payment-flow and network sections were inspected separately in the browser. All eight roadmap entries remain present, only USDC on Arc is styled live, and brand marks render from `@web3icons/react` rather than approximated artwork.

## Required fidelity surfaces

- Fonts and typography: Existing Space Grotesk display and DM Sans body families retained. Headline scale, weight, line height and three-line wrap match the source hierarchy at desktop; mobile remains readable without clipping.
- Spacing and layout rhythm: Marketing frame widened to 1340 px, section boundaries use whitespace and fine rules, and the hero/capability rail share the first viewport. Mobile sections stack without horizontal overflow.
- Colors and visual tokens: Existing Acqui navy, warm background and slate text retained; blue infrastructure accents and emerald live state align with the selected concept.
- Image quality and asset fidelity: USDC, Arc, Ethereum, Base, Solana and token marks come from the installed Web3 icon library. No placeholder logos, emoji, handcrafted SVGs or rasterized UI were introduced.
- Copy and content: Business-facing positioning and settlement language match the selected direction while preserving the product rule that only verified USDC on Arc is live.

## Comparison history

1. Initial comparison found a P1 hero proportion mismatch: the narrow frame forced a five-line headline and made the first section too tall. Fixed by tightening the hero, then widening the marketing frame and restoring the headline scale. Post-fix evidence shows the intended three-line wrap and first-viewport capability rail.
2. Second comparison found a P2 overlap in the settlement illustration: the central receipt obscured supporting-card copy. Fixed by resizing the receipt and moving supporting cards above its overlap zone. Post-fix evidence shows both labels fully readable.
3. Final comparison found no actionable P0, P1 or P2 differences.

## Interaction and responsive checks

- Primary `Start accepting payments` CTA navigated to `/merchants`.
- Navigation and demo links expose the correct routes.
- Browser console errors/warnings checked: none.
- Mobile checked at 390 × 844; navigation, headline, CTAs and illustration remain readable and vertically ordered.
- Production Vite build passed; focused lint and targeted tests passed.

## Follow-up polish

- P3: A future Docs route could support the extra navigation item shown in the concept; it was not invented for this landing-page change.
- P3: Decorative connector lines could be added later if a sourced design asset becomes available.

final result: passed
