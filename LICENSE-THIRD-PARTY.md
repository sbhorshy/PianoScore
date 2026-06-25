# Third-Party Licenses

PianoScore integrates the following third-party components. Each is a
**separate work**, invoked as an independent process (arm's length),
not linked into PianoScore's source.

## Audiveris

- **Purpose:** Optical Music Recognition (OMR) — converts PDF/images of
  sheet music to MusicXML.
- **License:** GNU Affero General Public License v3.0 (AGPL-3.0)
- **Source:** https://github.com/Audiveris/audiveris
- **Integration model:** PianoScore spawns Audiveris as an independent
  `java` subprocess via `child_process.spawn`. PianoScore does **not**
  import, link, or modify any Audiveris Java class. Communication is via
  the filesystem only (input PDF → output MusicXML).
- **License text:** See `LICENSES/AGPL-3.0.txt`
- **Compliance note:** Per the AGPL-3.0, the complete corresponding
  source code of Audiveris is available at the source link above.
  PianoScore uses the official, unmodified release jar.

## Tesseract OCR (via Audiveris)

- **Purpose:** Text recognition engine, bundled within Audiveris.
- **License:** Apache License 2.0
- **Source:** https://github.com/tesseract-ocr/tesseract
- **Note:** Used transitively by Audiveris. Not invoked directly by
  PianoScore.

---

**Legal disclaimer:** The process-isolation model above is the
GPL/AGPL community's accepted boundary for non-derivative works, but
has not been tested in court. Projects integrating AGPL components
should consult their own legal counsel.
