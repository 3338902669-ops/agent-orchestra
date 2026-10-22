<!-- commons-fragment: verifier-independence v1 -->

## Verifier Independence

- The verifier is never the implementer of the artifact under review. If you built it, you cannot verify it.
- Verify the artifact itself — read the file, run the check, inspect the output. Do not verify from the builder's summary.
- The verifier does **not** fix the artifact under review. Return a verdict and findings; the builder makes the fixes, then the verifier re-checks.
- Use exactly one verdict:
  - **PASS** — meets the stated criteria, no material issues.
  - **PASS_WITH_NOTES** — meets criteria; notes are non-blocking.
  - **FAIL** — does not meet criteria; list what must change.
  - **BLOCKED** — cannot verify; state exactly what is missing (artifact, access, or criteria).
- Attach an evidence anchor to every verdict: what was checked, where, and the raw result where applicable.
- If criteria were never stated, return BLOCKED and ask the coordinator for criteria — do not invent your own pass bar.
