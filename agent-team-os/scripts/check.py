#!/usr/bin/env python3
"""agent-team-os package checker.

Runs five verification suites over the package:

  HYGIENE    no deployment-specific identifiers anywhere in the package,
             plus a claims cross-check: numbers stated in the docs
             (placeholder count, suite count) must match reality
  COMPAT     compatibility-matrix rows reference existing files, and the
             seat roles in use are the five defined roles
  USABILITY  README/QUICKSTART paths exist, SKILL.md frontmatter valid and
             its declared name matches the package, all template
             placeholders documented and well-formed, internal links resolve
  ERROR      the checker itself, proven on scratch copies: a clean copy
             passes a full run, and three single-defect poisoned copies
             (banned term, broken reference, name mismatch) are each
             rejected with the expected named error; plus a locked-list
             regression probe -- an unreadable configured list held in
             a directory named by a listed term must abort with
             E_DENYLIST_CONFIG without echoing any path segment
  REPRO      templates instantiated with sample values validate cleanly,
             required sections are present, and instantiation is
             deterministic

Every finding is printed as a NAMED error; exit code is 0 only if all
suites pass. A full run ends with ALL CHECKS PASSED or CHECKS FAILED.

Modes (options and the positional ROOT may appear in any order):

  check.py [ROOT]              run all suites (default ROOT: package root)
  check.py --category NAME     run one suite: HYGIENE|COMPAT|USABILITY|ERROR|REPRO
  check.py --self-test         alias: run only the ERROR suite

Denylist: the hygiene suite loads its banned terms from OUTSIDE the
shipped package -- the file named by the AGENT_TEAM_OS_DENYLIST
environment variable, or denylist.local.txt in the package root
(git-ignored). Loading is fail-closed: a configured list that is
missing, unreadable, undecodable, or empty aborts the run with
E_DENYLIST_CONFIG instead of silently falling back. Only when
nothing is configured at all is the bundled denylist.example.txt
(deliberately fake terms) used, with a note printed; if that
bundled file cannot be read, the run aborts with E_DENYLIST_CONFIG
as well. The note and
any config error name the list file by basename only, and a read
failure is described by errno/strerror rather than the OS error
string: no directory segment of its path is echoed into logs (a
segment can itself be a listed term); the file's own basename is
printed, for operability. Lists are read as UTF-8 with an
optional BOM (utf-8-sig). The one list the loader actually loaded
is excluded from the scan by its resolved path, so the list never
introduces the terms it bans; no file is excluded for its name
alone. A leftover copy of the list in the package root under
another name is covered too: any root-level file whose parsed
term set is identical to the active list's is treated as a copy
of the list and excluded (matched by content; files below the
package root are always scanned at full strength). A hit is
reported with a mask that leaks neither the term's first
character nor its exact length.
"""

import hashlib
import os
import re
import shutil
import subprocess
import sys
import tempfile

PACKAGE_NAME = "agent-team-os"

AGENT_TYPES = ["MCP-native", "CLI", "GUI desktop", "API", "File-only"]
ROLES = ["coordinator", "builder", "verifier", "operator", "dispatcher"]
PLACEHOLDER_RE = re.compile(r"\{\{[A-Z][A-Z0-9_]*\}\}")
BACKTICK_RE = re.compile(r"`([^`\n]+)`")
LINK_RE = re.compile(r"\]\(([^)\s]+)\)")
NESTED_ENV = "AGENT_TEAM_OS_NESTED_ERROR"

SAMPLE = {
    "USER_HOME": "~",
    "WORK_DIR": "~/team",
    "BRIDGE_DIR": "~/team/bridge",
    "STORAGE_DIR": "~/team/mail-storage",
    "MAIL_SCHEME": "https",
    "MAIL_HOST": "192.0.2.10",
    "MAIL_PORT": "8765",
    "MAIL_BIN": "/usr/local/bin/mail-cli",
    "TOKEN_FILE": "~/team/bridge/mail-token.txt",
    "PROJECT_KEY": "example-team-mail",
    "PROJECT_PATH": "~/team/mail",
    "COORDINATOR_NAME": "Coordinator",
    "BUILDER_NAME": "Builder",
    "VERIFIER_NAME": "Verifier",
    "OPERATOR_NAME": "Operator",
    "DISPATCHER_NAME": "Dispatcher",
    "WAKE_COORDINATOR_CMD": "[\"team-bridge\", \"notify-coordinator\", \"{id}\"]",
    "WAKE_BUILDER_CMD": "[\"agent-cli\", \"run\", \"--session\", \"builder\", \"--prompt-file\", \"{prompt_file}\"]",
    "WAKE_VERIFIER_CMD": "[\"verifier-cli\", \"run\", \"--card\", \"{prompt_file}\"]",
    "WAKE_OPERATOR_CMD": "[\"bridge-task\", \"run\", \"operator-wake\"]",
    "WAKE_DISPATCHER_CMD": "[\"gui-wake\", \"--seat\", \"dispatcher\", \"--file\", \"{prompt_file}\"]",
}

REQUIRED_INSTANTIATED = [
    "MEMORY.md",
    "daily-log.md",
    "person.md",
    "group.md",
    "roster.md",
    "task-registry.md",
    "PLACEHOLDERS.md",
    "scripts/mail-helper.ps1",
    "scripts/doorbell.ps1",
]

REQUIRED_SECTIONS = {
    "MEMORY.md": ["## Facts", "## Preferences", "## Commitments"],
    "daily-log.md": ["## Events", "## Decisions", "## State Changes", "## Open Threads"],
    "person.md": ["## Identity", "## Relationship", "## Facts", "## Open Threads"],
    "group.md": ["## Purpose", "## Members", "## Dynamics", "## Open Threads"],
    "roster.md": ["## Rules of Engagement"],
    "task-registry.md": ["## Status Vocabulary", "## Notes"],
}


# ---------------------------------------------------------------------------
# helpers
# ---------------------------------------------------------------------------
def iter_files(root):
    for dirpath, dirnames, filenames in os.walk(root):
        for skip in (".git", "__pycache__"):
            if skip in dirnames:
                dirnames.remove(skip)
        for name in sorted(filenames):
            yield os.path.join(dirpath, name)


def read_text(path):
    with open(path, "r", encoding="utf-8", errors="replace") as fh:
        return fh.read()


def rel(root, path):
    return os.path.relpath(path, root).replace(os.sep, "/")


def looks_like_path(token):
    token = token.strip()
    if not token or " " in token or token.startswith(("http", "#", "mailto:")):
        return False
    return ("/" in token and not token.startswith("/")) or token.endswith(
        (".md", ".py", ".ps1", ".txt", ".json")
    )


class DenylistConfigError(Exception):
    """A denylist selected for loading could not be loaded.

    Fatal on purpose (fail-closed): silently falling back to the
    bundled example list would let a real deployment list go unused
    while every check still reports a pass; and when the bundled
    example list is itself the selected list, an unreadable copy
    aborts the same way instead of surfacing a raw traceback."""

    def __init__(self, path, detail):
        super().__init__(detail)
        self.path = path
        self.detail = detail


def read_list_terms(path):
    """Parse a denylist file: one term per line, '#' comments and
    blank lines ignored. Read as utf-8-sig so a BOM on the first line
    cannot silently poison the first term."""
    with open(path, "r", encoding="utf-8-sig", errors="strict") as fh:
        terms = []
        for line in fh.read().splitlines():
            line = line.strip()
            if line and not line.startswith("#"):
                terms.append(line)
    return terms


def _read_failure(exc):
    """A path-free description of why a list could not be read.

    str(OSError) embeds the full path with the filename repr-escaped
    (on Windows every backslash is doubled), and a path segment can
    itself be a listed term, so an OS error string must never reach
    the output. errno + strerror name the failure without naming
    the file; a decode failure is described by codec, reason and
    offset, which carry no path either."""
    if isinstance(exc, UnicodeDecodeError):
        return "undecodable content (%s codec: %s at byte %d)" % (
            exc.encoding, exc.reason, exc.start)
    if isinstance(exc, OSError):
        return "[Errno %s] %s" % (exc.errno, exc.strerror or type(exc).__name__)
    return type(exc).__name__


def load_denylist(root):
    """Return (terms, source_description, used_fallback).

    Fail-closed: a list the operator explicitly configured -- named
    by the AGENT_TEAM_OS_DENYLIST environment variable, or present
    as denylist.local.txt in the package root -- that is missing,
    unreadable, undecodable, or empty raises DenylistConfigError.
    The bundled example list is used only when nothing at all was
    configured."""
    env_path = os.environ.get("AGENT_TEAM_OS_DENYLIST")
    if env_path:
        if not os.path.isfile(env_path):
            raise DenylistConfigError(
                env_path,
                "AGENT_TEAM_OS_DENYLIST points at a file that does not exist",
            )
        try:
            terms = read_list_terms(env_path)
        except (OSError, UnicodeDecodeError) as exc:
            raise DenylistConfigError(
                env_path,
                "configured denylist could not be read: " + _read_failure(exc),
            )
        if not terms:
            raise DenylistConfigError(
                env_path, "configured denylist contains no terms"
            )
        return terms, env_path, False
    local = os.path.join(root, "denylist.local.txt")
    if os.path.exists(local):
        try:
            terms = read_list_terms(local)
        except (OSError, UnicodeDecodeError) as exc:
            raise DenylistConfigError(
                local,
                "denylist.local.txt could not be read: " + _read_failure(exc),
            )
        if not terms:
            raise DenylistConfigError(
                local, "denylist.local.txt contains no terms"
            )
        return terms, local, False
    example = os.path.join(root, "denylist.example.txt")
    terms = []
    if os.path.isfile(example):
        try:
            terms = read_list_terms(example)
        except (OSError, UnicodeDecodeError) as exc:
            raise DenylistConfigError(
                example,
                "bundled example denylist could not be read: "
                + _read_failure(exc),
            )
    return terms, example, True


def list_term_set(path):
    """The parsed term set of a candidate list file, or None if the
    file cannot be read as a list (missing, unreadable, undecodable).
    Parsing matches read_list_terms -- comments and blank lines
    ignored -- so two files carrying the same terms under different
    comments or ordering have the same term set."""
    try:
        return set(read_list_terms(path))
    except (OSError, UnicodeDecodeError):
        return None


def root_list_copies(root, terms):
    """Resolved paths of files in the package root whose term set is
    identical to the active list's. A deployment can leave a copy of
    its list behind under a name nobody configured -- an old private
    list file sitting in the root after the configured list moved
    outside the package -- and scanned as ordinary content it would
    be flagged by its own terms. Copies are recognized by CONTENT,
    the normalized term set, never by name alone, and only in the
    package root itself: a same-named (or even same-content) file in
    a subdirectory is ordinary content and is always scanned."""
    target = set(terms)
    if not target:
        return set()
    copies = set()
    try:
        names = os.listdir(root)
    except OSError:
        return copies
    for name in names:
        path = os.path.join(root, name)
        if os.path.isfile(path) and list_term_set(path) == target:
            copies.add(os.path.realpath(path))
    return copies


def denylist_exclusions(root, terms=(), source=None):
    """Resolved paths the hygiene scan never reads: the one list
    load_denylist() actually loaded -- matched by its resolved path,
    wherever it lives (the AGENT_TEAM_OS_DENYLIST file, a root
    denylist.local.txt the loader fell back to, or the bundled
    example list when nothing is configured) -- and any root-level
    copy of that list recognized by content (see root_list_copies).
    No file is excluded for its name alone: a root file that merely
    carries a conventional list name but different terms is ordinary
    content and is scanned at full strength."""
    excluded = set()
    if source:
        excluded.add(os.path.realpath(source))
    excluded |= root_list_copies(root, terms)
    return excluded


def mask_term(term):
    """Render a banned term for a finding without leaking it: neither
    the term, nor its first character, nor its exact length -- only
    a coarse length bucket, so reports stay useful without becoming
    an enumeration oracle."""
    n = len(term)
    if n <= 4:
        bucket = "up to 4 chars"
    elif n <= 8:
        bucket = "5-8 chars"
    elif n <= 16:
        bucket = "9-16 chars"
    else:
        bucket = "over 16 chars"
    return "*** (" + bucket + ")"


def documented_placeholders(root):
    ph_doc = os.path.join(root, "templates", "PLACEHOLDERS.md")
    if not os.path.isfile(ph_doc):
        return set()
    return {m[2:-2] for m in PLACEHOLDER_RE.findall(read_text(ph_doc))}


# ---------------------------------------------------------------------------
# suites
# ---------------------------------------------------------------------------
def check_hygiene(root, findings):
    terms, _source, _fallback = load_denylist(root)
    if not terms:
        findings.append(("E_STRUCTURE_MISSING", "denylist", "no denylist terms could be loaded (external list and denylist.example.txt both empty or missing)"))
    excluded = denylist_exclusions(root, terms, _source)
    for path in iter_files(root):
        if os.path.realpath(path) in excluded:
            continue  # the instrument itself is not scanned
        text = read_text(path)
        for term in terms:
            if term and term in text:
                findings.append(
                    ("E_HYGIENE_BANNED_TERM", rel(root, path), "banned term " + mask_term(term))
                )
    check_claims(root, findings)


def check_claims(root, findings):
    """Numbers stated in the docs must match the package's real values."""
    n_placeholders = len(documented_placeholders(root))
    n_suites = len(SUITES)
    ph_re = re.compile(r"(\d+)\s+placeholders?\b")
    suite_re = re.compile(r"(\d+)\s+(?:verification\s+)?suites?\b")
    for path in iter_files(root):
        if not path.endswith(".md"):
            continue
        for lineno, line in enumerate(read_text(path).splitlines(), 1):
            for m in ph_re.finditer(line):
                if int(m.group(1)) != n_placeholders:
                    findings.append((
                        "E_CLAIMS_PLACEHOLDER_COUNT", rel(root, path),
                        "line %d states %s placeholders; PLACEHOLDERS.md defines %d"
                        % (lineno, m.group(1), n_placeholders),
                    ))
            for m in suite_re.finditer(line):
                if int(m.group(1)) != n_suites:
                    findings.append((
                        "E_CLAIMS_SUITE_COUNT", rel(root, path),
                        "line %d states %s suites; the checker runs %d"
                        % (lineno, m.group(1), n_suites),
                    ))


def check_compat(root, findings):
    doc = os.path.join(root, "references", "adapters-compatibility.md")
    if not os.path.isfile(doc):
        findings.append(("E_STRUCTURE_MISSING", "references/adapters-compatibility.md", "compatibility doc missing"))
        return
    text = read_text(doc)
    marker = "## Compatibility matrix"
    if marker not in text:
        findings.append(("E_COMPAT_TYPE_UNCOVERED", "references/adapters-compatibility.md", "no compatibility matrix section"))
        return
    section = text.split(marker, 1)[1]
    next_h = section.find("\n## ")
    if next_h >= 0:
        section = section[:next_h]
    rows = [ln for ln in section.splitlines() if ln.strip().startswith("|") and "---" not in ln]
    for atype in AGENT_TYPES:
        matched = []
        for row in rows:
            cells = [c.strip() for c in row.strip().strip("|").split("|")]
            if cells and atype.lower() in cells[0].lower():
                matched.append(row)
        if not matched:
            findings.append(("E_COMPAT_TYPE_UNCOVERED", "references/adapters-compatibility.md", "no matrix row for agent type: " + atype))
            continue
        existing = 0
        for row in matched:
            for token in BACKTICK_RE.findall(row):
                if looks_like_path(token):
                    if os.path.exists(os.path.join(root, token)):
                        existing += 1
                    else:
                        findings.append(("E_COMPAT_MISSING_FILE", "references/adapters-compatibility.md", atype + " references missing file: " + token))
        if existing < 2:
            findings.append(("E_COMPAT_TYPE_UNCOVERED", "references/adapters-compatibility.md", atype + " row references fewer than 2 existing files"))

    # Seat roles in use must be the five defined roles: the declaration in
    # the compatibility doc, and the role column of the roster template
    # the matrix wires every agent type to.
    m = re.search(r"Seat roles used with these adapters:\s*([^\n]+)", text)
    if not m:
        findings.append(("E_COMPAT_ROLE_UNKNOWN", "references/adapters-compatibility.md", "no 'Seat roles used with these adapters' declaration"))
    else:
        declared = [r.strip().strip(".") for r in re.split(r",|\band\b", m.group(1)) if r.strip()]
        for role in declared:
            if role not in ROLES:
                findings.append(("E_COMPAT_ROLE_UNKNOWN", "references/adapters-compatibility.md", "undeclared seat role in compatibility doc: " + role))
    roster = os.path.join(root, "templates", "roster.md")
    if os.path.isfile(roster):
        for line in read_text(roster).splitlines():
            if not line.strip().startswith("|") or "---" in line:
                continue
            cells = [c.strip() for c in line.strip().strip("|").split("|")]
            if len(cells) >= 2 and cells[1] and cells[1] != "Role":
                if cells[1] not in ROLES:
                    findings.append(("E_COMPAT_ROLE_UNKNOWN", "templates/roster.md", "seat role not one of the five defined roles: " + cells[1]))


def check_usability(root, findings):
    # SKILL.md frontmatter + declared name matches the package
    skill = os.path.join(root, "SKILL.md")
    if not os.path.isfile(skill):
        findings.append(("E_STRUCTURE_MISSING", "SKILL.md", "skill entry file missing"))
    else:
        text = read_text(skill)
        fm = None
        if text.startswith("---\n"):
            end = text.find("\n---", 4)
            if end > 0:
                fm = text[4:end]
        if fm is None or not re.search(r"^name:\s*\S+", fm, re.M) or not re.search(r"^description:\s*\S+", fm, re.M):
            findings.append(("E_USABILITY_FRONTMATTER", "SKILL.md", "frontmatter must open with --- and contain non-empty name: and description:"))
        else:
            name_m = re.search(r"^name:\s*(\S+)\s*$", fm, re.M)
            if name_m and name_m.group(1) != PACKAGE_NAME:
                findings.append(("E_USABILITY_NAME_MISMATCH", "SKILL.md", "declared name '%s' does not match package name '%s'" % (name_m.group(1), PACKAGE_NAME)))

    # README / QUICKSTART referenced paths (root-relative)
    for name in ("README.md", "QUICKSTART.md"):
        path = os.path.join(root, name)
        if not os.path.isfile(path):
            findings.append(("E_STRUCTURE_MISSING", name, "required root doc missing"))
            continue
        text = read_text(path)
        tokens = [t for t in BACKTICK_RE.findall(text) if looks_like_path(t)]
        tokens += [t.split("#")[0] for t in LINK_RE.findall(text) if looks_like_path(t.split("#")[0])]
        for token in sorted(set(tokens)):
            if not os.path.exists(os.path.join(root, token)):
                findings.append(("E_USABILITY_DEAD_PATH", name, "referenced path does not exist: " + token))

    # All relative markdown links anywhere must resolve
    for path in iter_files(root):
        if not path.endswith(".md"):
            continue
        text = read_text(path)
        for target in LINK_RE.findall(text):
            if target.startswith(("http", "#", "mailto:")):
                continue
            target = target.split("#")[0]
            if not target:
                continue
            resolved = os.path.normpath(os.path.join(os.path.dirname(path), target))
            if not os.path.exists(resolved):
                findings.append(("E_USABILITY_DEAD_PATH", rel(root, path), "dead relative link: " + target))

    # Placeholder discipline in templates/
    tdir = os.path.join(root, "templates")
    documented = documented_placeholders(root)
    if not os.path.isfile(os.path.join(tdir, "PLACEHOLDERS.md")):
        findings.append(("E_STRUCTURE_MISSING", "templates/PLACEHOLDERS.md", "placeholder documentation missing"))
    if os.path.isdir(tdir):
        for path in iter_files(tdir):
            text = read_text(path)
            idx = 0
            used = set()
            while True:
                idx = text.find("{{", idx)
                if idx < 0:
                    break
                m = PLACEHOLDER_RE.match(text, idx)
                if not m:
                    findings.append(("E_PLACEHOLDER_MALFORMED", rel(root, path), "malformed placeholder at offset " + str(idx)))
                    idx += 2
                    continue
                used.add(m.group(0)[2:-2])
                idx = m.end()
            for token in sorted(used - documented):
                findings.append(("E_PLACEHOLDER_UNDOCUMENTED", rel(root, path), "placeholder not documented in PLACEHOLDERS.md: {{" + token + "}}"))


def check_repro(root, findings):
    tdir = os.path.join(root, "templates")
    if not os.path.isdir(tdir):
        findings.append(("E_STRUCTURE_MISSING", "templates", "templates directory missing"))
        return
    tmp = tempfile.mkdtemp(prefix="agent-team-os-inst-")
    try:
        _repro_body(findings, tdir, tmp)
    finally:
        # Scratch copies are always removed: instantiated templates
        # carry filled deployment values and must not linger in the
        # system temp directory.
        shutil.rmtree(tmp, ignore_errors=True)
    if os.path.exists(tmp):
        findings.append(("E_REPRO_TEMP_RESIDUE", "templates", "instantiation scratch directory was not removed: " + tmp))


def _repro_body(findings, tdir, tmp):
    def instantiate(name):
        dst = os.path.join(tmp, name)
        shutil.copytree(tdir, dst)
        count = 0
        for path in iter_files(dst):
            text = read_text(path)
            count += 1
            new = text
            for key, value in SAMPLE.items():
                new = new.replace("{{" + key + "}}", value)
            if new != text:
                with open(path, "w", encoding="utf-8") as fh:
                    fh.write(new)
        return dst, count

    def signature(base):
        sig = {}
        for path in iter_files(base):
            with open(path, "rb") as fh:
                sig[rel(base, path)] = hashlib.sha256(fh.read()).hexdigest()
        return sig

    dst, n_files = instantiate("instantiated")
    dst2, _ = instantiate("instantiated-again")
    if signature(dst) != signature(dst2):
        findings.append(("E_REPRO_NONDETERMINISTIC", "templates", "two instantiations with the same sample values produced different trees"))

    for path in iter_files(dst):
        text = read_text(path)
        for token in PLACEHOLDER_RE.findall(text):
            token_name = token[2:-2]
            if token_name in SAMPLE:
                findings.append(("E_REPRO_LEFTOVER_PLACEHOLDER", rel(dst, path), "placeholder survived substitution: " + token))
            else:
                findings.append(("E_REPRO_NO_SAMPLE", rel(dst, path), "no sample value for placeholder: " + token))
    for req in REQUIRED_INSTANTIATED:
        if not os.path.isfile(os.path.join(dst, req)):
            findings.append(("E_STRUCTURE_MISSING", "templates/" + req, "required instantiated file missing"))
    for fname, sections in REQUIRED_SECTIONS.items():
        fpath = os.path.join(dst, fname)
        if not os.path.isfile(fpath):
            continue
        text = read_text(fpath)
        for section in sections:
            if section not in text:
                findings.append(("E_REPRO_SECTION_MISSING", "templates/" + fname, "required section missing after instantiation: " + section))
    frag_dir = os.path.join(dst, "commons-fragments")
    frags = [f for f in os.listdir(frag_dir) if f.endswith(".md")] if os.path.isdir(frag_dir) else []
    if len(frags) < 3:
        findings.append(("E_STRUCTURE_MISSING", "templates/commons-fragments", "need at least 3 commons fragments, found " + str(len(frags))))
    roster = os.path.join(dst, "roster.md")
    if os.path.isfile(roster) and SAMPLE["COORDINATOR_NAME"] not in read_text(roster):
        findings.append(("E_REPRO_LEFTOVER_PLACEHOLDER", "templates/roster.md", "instantiated roster lacks the sample coordinator identity"))
    bell = os.path.join(dst, "scripts", "doorbell.ps1")
    if os.path.isfile(bell) and SAMPLE["MAIL_HOST"] not in read_text(bell):
        findings.append(("E_REPRO_LEFTOVER_PLACEHOLDER", "templates/scripts/doorbell.ps1", "instantiated doorbell lacks the sample mail host"))
    print("REPRO instantiated %d template files (scratch directory removed after the run)" % n_files)


def _fixture_ignore(root, source, fallback):
    """copytree ignore for the ERROR suite's scratch copies.

    Always skips .git and __pycache__. Additionally skips the ACTIVE
    denylist file itself -- identified by the path load_denylist()
    actually loaded, not by name -- when that file lives inside the
    package root: a copy of it would sit at a different resolved path
    than denylist_exclusions() excludes, so a fixture run would scan
    the list against its own terms and the clean control could never
    pass. That one file is skipped, matched by its path relative to
    the root. Root-level copies of the list under other names are
    skipped by the same rule the scan uses -- content: a root file
    whose term set is identical to the active list's is a copy of
    the list (see root_list_copies) -- which keeps list content out
    of the scratch copies entirely, wherever the active list lives.
    Every other file, including anything below the package root, is
    copied and scanned at full strength. The bundled example list is
    never skipped this way: when it is the fallback, it is a shipped
    package file the copies need (and in each copy it is the list
    the loader loads, so the scan excludes it there by resolved
    path, like any active list)."""
    patterns = shutil.ignore_patterns(".git", "__pycache__")
    if fallback or not source:
        return patterns
    root_real = os.path.realpath(root)
    src_real = os.path.realpath(source)
    active_terms = list_term_set(source)
    active_rel = None
    if src_real.startswith(root_real + os.sep):
        active_rel = os.path.relpath(src_real, root_real)
    if active_rel is None and not active_terms:
        return patterns

    def ignore(dirpath, names):
        skipped = set(patterns(dirpath, names))
        here = os.path.relpath(dirpath, root)
        if here == ".":
            here = ""
        if active_rel is not None:
            active_name = os.path.basename(active_rel)
            if here == os.path.dirname(active_rel) and active_name in names:
                skipped.add(active_name)
        if here == "" and active_terms:
            for name in names:
                path = os.path.join(dirpath, name)
                if os.path.isfile(path) and list_term_set(path) == active_terms:
                    skipped.add(name)
        return skipped

    return ignore


def _lock_file_exclusive(path):
    """Best effort: hold `path` so that other processes cannot read
    it, and return a zero-argument unlock callable. Return None when
    this platform/user cannot make the file unreadable -- detected
    by a trial open, not assumed (POSIX root ignores mode bits) --
    so the locked-list probe skips itself rather than passing
    vacuously."""
    if os.name == "nt":
        import ctypes
        from ctypes import wintypes
        kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
        kernel32.CreateFileW.restype = wintypes.HANDLE
        kernel32.CreateFileW.argtypes = [
            wintypes.LPCWSTR, wintypes.DWORD, wintypes.DWORD,
            wintypes.LPVOID, wintypes.DWORD, wintypes.DWORD,
            wintypes.HANDLE,
        ]
        handle = kernel32.CreateFileW(path, 0x80000000, 0, None, 3, 0x80, None)
        hval = handle.value if hasattr(handle, "value") else handle
        if hval in (None, 0, -1, 0xFFFFFFFFFFFFFFFF):
            return None
        try:
            with open(path, "r"):
                pass
        except OSError:
            def unlock():
                kernel32.CloseHandle(handle)
            return unlock
        kernel32.CloseHandle(handle)
        return None
    try:
        mode = os.stat(path).st_mode
        os.chmod(path, 0)
    except OSError:
        return None
    try:
        with open(path, "r"):
            pass
    except OSError:
        def unlock():
            try:
                os.chmod(path, mode)
            except OSError:
                pass
        return unlock
    try:
        os.chmod(path, mode)
    except OSError:
        pass
    return None


def _locked_list_probe(root, findings, checker, tmp, terms, base_env):
    """Regression probe: a configured list that exists but cannot
    be read must abort the run with E_DENYLIST_CONFIG, and the
    error output must not echo any segment of the list's path. A
    path segment can itself be a listed term, so the real list's
    first term is used as the name of the directory holding the
    locked list; if that term -- or the list's full path, raw or
    repr-escaped -- appears in the output, the probe fails. Where
    the current user cannot make a file unreadable, the probe
    reports itself skipped instead of passing vacuously."""
    if not terms:
        print("ERROR suite: locked-list probe skipped (denylist is empty)")
        return
    marker = terms[0]
    if (not marker or marker in (".", "..") or os.sep in marker
            or (os.altsep and os.altsep in marker)):
        print("ERROR suite: locked-list probe skipped "
              "(first term is not a usable directory name)")
        return
    holder = os.path.join(tmp, marker)
    locked = os.path.join(holder, "locked-list.txt")
    try:
        os.makedirs(holder)
        with open(locked, "w", encoding="utf-8") as fh:
            fh.write("\n".join(terms) + "\n")
    except OSError:
        print("ERROR suite: locked-list probe skipped "
              "(first term is not a usable directory name)")
        return
    unlock = _lock_file_exclusive(locked)
    if unlock is None:
        print("ERROR suite: locked-list probe skipped "
              "(cannot make a file unreadable as this user)")
        return
    try:
        env = dict(base_env)
        env["AGENT_TEAM_OS_DENYLIST"] = locked
        proc = subprocess.run(
            [sys.executable, checker, root],
            capture_output=True, text=True, timeout=600, env=env,
        )
        out = proc.stdout + proc.stderr
    finally:
        unlock()
    if proc.returncode != 2 or "E_DENYLIST_CONFIG" not in out:
        findings.append(("E_ERROR_FIXTURE_MISS", "ERROR suite",
                         "locked-list probe was not aborted with "
                         "E_DENYLIST_CONFIG (exit %s)" % proc.returncode))
    elif (marker in out or locked in out
            or locked.replace("\\", "\\\\") in out):
        findings.append(("E_ERROR_FIXTURE_MISS", "ERROR suite",
                         "locked-list probe echoed a path segment "
                         "into the error output"))
    else:
        print("ERROR suite: locked-list probe passed "
              "(unreadable list aborts; no path echoed)")


def _locked_example_probe(root, findings, checker, tmp, ignore, base_env):
    """Regression probe: with nothing configured at all (no env
    variable, no denylist.local.txt), an unreadable bundled example
    list must abort the run with E_DENYLIST_CONFIG exactly like a
    configured list -- the fallback read obeys the same
    _read_failure() discipline, so no raw traceback reaches the
    output, and neither a term nor the example file's full path may
    appear in it. The scratch copy is staged under a directory
    named by the example list's first term, so a leaked path would
    leak a term too. Where the current user cannot make a file
    unreadable, the probe reports itself skipped instead of passing
    vacuously."""
    example_src = os.path.join(root, "denylist.example.txt")
    try:
        ex_terms = read_list_terms(example_src)
    except (OSError, UnicodeDecodeError):
        ex_terms = []
    if not ex_terms:
        print("ERROR suite: locked-example probe skipped "
              "(no bundled example terms)")
        return
    marker = ex_terms[0]
    usable = (marker and marker not in (".", "..")
              and os.sep not in marker
              and not (os.altsep and os.altsep in marker))
    holder = os.path.join(tmp, "locked-example", marker if usable else "pkg")
    dst = os.path.join(holder, "pkg")
    try:
        os.makedirs(holder)
        shutil.copytree(root, dst, ignore=ignore)
    except OSError:
        print("ERROR suite: locked-example probe skipped "
              "(scratch copy could not be staged)")
        return
    local = os.path.join(dst, "denylist.local.txt")
    if os.path.isfile(local):
        os.remove(local)
    example_copy = os.path.join(dst, "denylist.example.txt")
    if not os.path.isfile(example_copy):
        print("ERROR suite: locked-example probe skipped "
              "(bundled example list missing from the scratch copy)")
        return
    unlock = _lock_file_exclusive(example_copy)
    if unlock is None:
        print("ERROR suite: locked-example probe skipped "
              "(cannot make a file unreadable as this user)")
        return
    try:
        env = dict(base_env)
        env.pop("AGENT_TEAM_OS_DENYLIST", None)
        proc = subprocess.run(
            [sys.executable, checker, dst],
            capture_output=True, text=True, timeout=600, env=env,
        )
        out = proc.stdout + proc.stderr
    finally:
        unlock()
    if proc.returncode != 2 or "E_DENYLIST_CONFIG" not in out:
        findings.append(("E_ERROR_FIXTURE_MISS", "ERROR suite",
                         "locked-example probe was not aborted with "
                         "E_DENYLIST_CONFIG (exit %s)" % proc.returncode))
    elif ("Traceback" in out or example_copy in out
            or example_copy.replace("\\", "\\\\") in out
            or any(term in out for term in ex_terms)):
        findings.append(("E_ERROR_FIXTURE_MISS", "ERROR suite",
                         "locked-example probe echoed a traceback, "
                         "a term, or the full path into the output"))
    else:
        print("ERROR suite: locked-example probe passed "
              "(unreadable bundled example aborts; no path echoed)")


def check_error(root, findings):
    """Prove the checker itself: clean control passes; poisoned copies are
    rejected with the expected named errors; a locked-list regression
    probe (see _locked_list_probe) proves an unreadable configured list
    aborts without echoing any directory segment, and a locked-example
    probe (see _locked_example_probe) proves the bundled fallback read
    aborts the same way. Fixture runs are full checker
    runs on scratch copies, with the ERROR suite disabled inside them via
    an environment guard so the suite does not recurse. The copies omit
    the active denylist when it lives inside the package root, and
    root-level copies of it recognized by content (see _fixture_ignore):
    copied to a new path they would escape the scan exclusion and be
    flagged by their own terms. Fixture runs instead
    load the list from a staged copy in the suite scratch directory,
    so they still check against the real terms. Scratch copies are
    deleted when the suite finishes: they can contain a verbatim banned
    term (the poison fixture), so they must never linger in the temp
    directory."""
    if os.environ.get(NESTED_ENV) == "1":
        print("ERROR suite: skipped inside a fixture run")
        return
    checker = os.path.abspath(__file__)
    tmp = tempfile.mkdtemp(prefix="agent-team-os-error-")
    try:
        _error_body(root, findings, checker, tmp)
    finally:
        shutil.rmtree(tmp, ignore_errors=True)
    if os.path.exists(tmp):
        findings.append(("E_ERROR_TEMP_RESIDUE", "ERROR suite", "fixture scratch directory was not removed: " + tmp))


def _error_body(root, findings, checker, tmp):
    env = dict(os.environ)
    env[NESTED_ENV] = "1"
    terms, source, fallback = load_denylist(root)
    ignore = _fixture_ignore(root, source, fallback)
    if not fallback and source:
        root_real = os.path.realpath(root)
        src_real = os.path.realpath(source)
        if src_real.startswith(root_real + os.sep):
            # The active list lives inside the package, so the copies
            # omit it (see _fixture_ignore) -- but the fixture runs
            # must still check against the REAL terms, not fall back
            # to the bundled example list. Stage a copy in the suite
            # scratch directory (deleted with it, like every fixture)
            # and point the fixture runs at it.
            staged = os.path.join(tmp, "active-denylist.txt")
            shutil.copyfile(source, staged)
            env["AGENT_TEAM_OS_DENYLIST"] = staged

    def fresh_copy(name):
        dst = os.path.join(tmp, name)
        shutil.copytree(root, dst, ignore=ignore)
        return dst

    def run(target):
        proc = subprocess.run(
            [sys.executable, checker, target],
            capture_output=True, text=True, timeout=600, env=env,
        )
        return proc.returncode, proc.stdout + proc.stderr

    clean = fresh_copy("clean")
    code, out = run(clean)
    if code != 0:
        findings.append(("E_ERROR_CLEAN_CONTROL", "ERROR suite", "clean copy did not pass a full run"))
        print(out)

    cases = []
    if terms:
        poison = fresh_copy("poison-banned")
        gov = os.path.join(poison, "references", "governance.md")
        target_file = gov if os.path.isfile(gov) else os.path.join(poison, "SKILL.md")
        with open(target_file, "a", encoding="utf-8") as fh:
            fh.write("\n" + terms[0] + "\n")
        cases.append(("banned term", poison, "E_HYGIENE_BANNED_TERM"))
    else:
        findings.append(("E_ERROR_FIXTURE_MISS", "ERROR suite", "denylist is empty; the banned-term fixture cannot be built"))

    poison = fresh_copy("poison-broken-ref")
    with open(os.path.join(poison, "QUICKSTART.md"), "a", encoding="utf-8") as fh:
        fh.write("\nSee `references/does-not-exist.md` for details.\n")
    cases.append(("broken reference", poison, "E_USABILITY_DEAD_PATH"))

    poison = fresh_copy("poison-name")
    skill = os.path.join(poison, "SKILL.md")
    text = read_text(skill)
    with open(skill, "w", encoding="utf-8") as fh:
        fh.write(text.replace("name: " + PACKAGE_NAME, "name: not-the-package", 1))
    cases.append(("name mismatch", poison, "E_USABILITY_NAME_MISMATCH"))

    for label, target, expected in cases:
        code, out = run(target)
        if code == 0:
            findings.append(("E_ERROR_FIXTURE_MISS", "ERROR suite", label + " fixture passed the checker; expected " + expected))
        elif expected not in out:
            findings.append(("E_ERROR_FIXTURE_MISS", "ERROR suite", label + " fixture rejected but without the expected named error " + expected))
    _locked_list_probe(clean, findings, checker, tmp, terms, env)
    _locked_example_probe(root, findings, checker, tmp, ignore, env)
    print("ERROR suite: clean control + %d poisoned fixtures exercised" % len(cases))


SUITES = {
    "HYGIENE": check_hygiene,
    "COMPAT": check_compat,
    "USABILITY": check_usability,
    "ERROR": check_error,
    "REPRO": check_repro,
}


def run_all(root, only=None):
    _terms, source, fallback = load_denylist(root)
    if fallback:
        print("NOTE: no external denylist configured; hygiene uses the bundled example list (%s). "
              "Set AGENT_TEAM_OS_DENYLIST or add denylist.local.txt for a real deployment list."
              % os.path.basename(source))
    else:
        # Basename only: a segment of the configured path (a user
        # name, a host name) can itself be a listed term, and the
        # full path must never be echoed into logs.
        print("NOTE: hygiene denylist loaded from %s" % os.path.basename(source))
    per_suite = {}
    for name, fn in SUITES.items():
        if only and name != only:
            continue
        findings = []
        fn(root, findings)
        per_suite[name] = findings
    total = 0
    for name, findings in per_suite.items():
        total += len(findings)
        status = "PASS" if not findings else "FAIL (%d findings)" % len(findings)
        print("%s: %s" % (name, status))
        for code, where, detail in findings:
            print("  [%s] %s: %s" % (code, where, detail))
    if only is None:
        if total == 0:
            print("ALL CHECKS PASSED")
        else:
            print("CHECKS FAILED: %d findings" % total)
    return 1 if total else 0


# ---------------------------------------------------------------------------
# --self-test: alias for running only the ERROR suite
# ---------------------------------------------------------------------------
def self_test(root):
    findings = []
    check_error(root, findings)
    if findings:
        print("SELF-TEST FAIL: %d findings" % len(findings))
        for code, where, detail in findings:
            print("  [%s] %s: %s" % (code, where, detail))
        return 1
    print("SELF-TEST PASS: clean control passes; poisoned fixtures rejected with named errors "
          "(E_HYGIENE_BANNED_TERM, E_USABILITY_DEAD_PATH, E_USABILITY_NAME_MISMATCH)")
    return 0


def main(argv):
    root = None
    category = None
    selftest = False
    i = 1
    while i < len(argv):
        a = argv[i]
        if a == "--self-test":
            selftest = True
        elif a == "--category":
            i += 1
            if i >= len(argv):
                print("ERROR E_USAGE: --category requires a value")
                return 2
            category = argv[i].upper()
        elif a.startswith("--category="):
            category = a.split("=", 1)[1].upper()
        elif a.startswith("--"):
            print("ERROR E_USAGE: unknown option " + a)
            return 2
        elif root is None:
            root = a
        else:
            print("ERROR E_USAGE: multiple ROOT arguments")
            return 2
        i += 1
    if root is None:
        root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    root = os.path.abspath(root)
    try:
        if selftest:
            return self_test(root)
        if category is not None:
            if category not in SUITES:
                print("ERROR E_USAGE: unknown category '%s' (expected one of %s)"
                      % (category, ", ".join(SUITES)))
                return 2
            return run_all(root, only=category)
        return run_all(root)
    except DenylistConfigError as exc:
        # Fail closed: a denylist that cannot be loaded aborts the
        # run with a named error. The checker never reports a pass
        # it did not actually perform. The list file is named by
        # basename only, and the detail is built path-free at the
        # raise site (see _read_failure): no directory segment of
        # the path is echoed (a segment can itself be a listed
        # term); the basename is printed deliberately.
        base = os.path.basename(exc.path)
        print("ERROR E_DENYLIST_CONFIG: %s (file: %s)" % (exc.detail, base))
        return 2


if __name__ == "__main__":
    sys.exit(main(sys.argv))
