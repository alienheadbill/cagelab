# Source / authoring references

Files in this directory are **not runtime data**. They are retained only when they help explain how committed CageLab data was originally authored.

The runtime source of truth for the fighter roster is:

`src/data/fighters.js`

## ufc-datalab-roster-authoring-snapshot.txt

This file was originally committed at the repository root on August 27, 2026 under the accidental working name `roater`.

It is a one-off generated authoring snapshot containing 420 `F(...)` fighter rows. Its own header records that the ratings were generated from UFC-DataLab per-fight statistics and describes the rating derivation.

It must **not** be imported by the application or used to overwrite the current roster automatically.

At the time this reference was moved into this directory:

- 417 of 420 rows matched `src/data/fighters.js` exactly.
- The three differing rows reflected later division corrections in the runtime roster:
  - John Lineker: snapshot Flyweight → runtime Bantamweight.
  - Sean Sherk: snapshot Lightweight → runtime Welterweight.
  - Frankie Edgar: snapshot Lightweight → runtime Featherweight.

That divergence is intentional evidence that this is an historical authoring artifact, not a live data source.

## Licensing / provenance caution

The snapshot header cites `github.com/komaksym/UFC-DataLab` and notes that repository's MIT license. CageLab's roadmap records a separate unresolved provenance/legal question: UFC-DataLab's underlying fight data was sourced from official UFC properties, and the repository's MIT license does not by itself establish redistribution rights for all underlying source data.

Therefore:

- retain this file only as internal project provenance/reference;
- do not treat it as clearance to ship historical UFC event/card data;
- do not use it as the source for production Fight Card fixtures without the separate provenance/legal review tracked in the roadmap.

For current gameplay values, always use the committed runtime modules rather than this snapshot.
