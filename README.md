# Kode of Brewing

An interactive brewing guide for Kode and Barista Hustle, combining an animated FB45 cutaway with a Coffee Control Chart.

## Run locally

No build step or dependencies are required. From this repository:

```sh
python3 -m http.server 8765 --directory dist
```

Open http://localhost:8765 in your browser. Use a local server rather than opening the HTML file directly so browser storage works consistently.

## Features

- Simple, Advanced and Actual modes.
- Mild, Medium and Bold recipes, with Medium selected initially.
- Adjustable dose, water, temperature, pulse timing, pour rate, height and pattern.
- Circular pouring that pauses between pulses; adjustable rotation period.
- Double-walled server with a cropped or expanded view.
- Zoomable Coffee Control Chart with animated preference and measuring rulers.
- Refractometer inputs for measured TDS and calculated extraction yield.
- Editable recipe presets saved in the current browser, with original defaults available to restore.

## Measurements and estimates

The brewing animation is an educational approximation, not a validated fluid simulation. Recipe extraction values are estimates and are separate from the particle movement model. The mild and bold starting recipes are based on *Kode of Brewing* by Gordon Howell and Jem Challender; Medium is an intermediate example.

Actual mode uses the user's TDS reading, collected beverage weight and dry coffee dose:

```text
Extraction yield (%) = TDS (%) × beverage weight (g) ÷ dry coffee dose (g)
```

Estimated beverage weight assumes the grounds retain twice the dry coffee dose in water. Actual mode uses measured beverage weight instead.

Recipe changes are stored locally in the browser; they are not synced between devices. The app has no backend or user accounts.

## Source layout

- `dist/index.html`: interface, styles, chart and ruler interactions.
- `dist/simulation.js`: brewer animation, recipe state, measurement calculations and saved presets.
- `dist/graph-zoom.js`: chart zoom, pan and reading visibility.
- `dist/`: Kode and Barista Hustle logo assets and the FB45 reference drawing.

## References and assets

The app includes links to Barista Hustle, Jonathan Gagné's Coffee ad Astra, Park et al. (2025), and YUKI's Coffee University. Logo assets were sourced from the respective brand websites; the FB45 cutaway comes from the Kode brewing material. Brand marks and reference artwork remain the property of their respective owners. No license is granted to those assets by this repository.
