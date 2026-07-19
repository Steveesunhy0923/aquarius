r"""Chemical-equation corpus: paired (decoder LaTeX, mhchem source) entries.

Chemistry handwriting has no public online-stroke dataset, so chem samples are
SYNTHESIZED (src/chem_synth.py) by stitching real MathWriting symbol inks over
this corpus. Every entry carries the same chemistry in two forms:

    latex  MathWriting-convention decoder LaTeX  2H_{2}+O_{2}\rightarrow 2H_{2}O
    ce     mhchem source (the app's storage)     2H2 + O2 -> 2H2O

Both strings render from ONE structured recipe (Species / Reaction below):
species = optional coefficient + element/group sequence with digit subscripts
+ optional charge + optional state, plus isotope prefixes, hydrates and bond
marks. Because a single structure emits both forms, they can never disagree —
and the CONSISTENCY GATE additionally asserts
`latex_to_ce(entry.latex) == entry.ce` for every emitted entry, which is the
exact contract of the serving layer (serve.py chem mode). No \frac anywhere:
coefficients stay integers.

Content: ~80 curated real reactions/species (combustion, neutralization,
redox, precipitation, equilibria, ions, isotopes, hydrates, complexes) plus a
seeded random generator composing plausible salts/ions/equations from real
element and polyatomic-ion tables (charge-balanced formulas, balanced
synthesis/decomposition templates).

Self-test:
    ml/.venv/bin/python -m src.chem_corpus
"""

from __future__ import annotations

import random
import re
from dataclasses import dataclass
from math import gcd

from .chem_normalize import latex_to_ce


@dataclass(frozen=True)
class Species:
    """One chemical species: coeff + isotope? + items + charge? + state? + hydrate?"""

    coeff: int = 1
    isotope: tuple[int, int] | None = None  # (mass number, atomic number)
    # items: ("el", symbol, count) | ("grp", "(" or "[", items, count) | ("bond", "-"|"="|"#")
    items: tuple = ()
    charge: str = ""  # "", "+", "-", "2-", "3+"
    state: str = ""  # "", "aq", "s", "g", "l"
    hydrate: int = 0  # n of ·nH2O


@dataclass(frozen=True)
class Reaction:
    lhs: tuple[Species, ...]
    arrow: str  # "->" | "<=>" | "<-"
    rhs: tuple[Species, ...]


@dataclass(frozen=True)
class Entry:
    """One corpus item: the SAME chemistry as decoder LaTeX and mhchem source."""

    latex: str
    ce: str


# --------------------------------------------------------------------------
# parsing (mhchem-like source text -> structure)

_ELEMENT = re.compile(r"[A-Z][a-z]?")
_DIGITS = re.compile(r"\d+")
_ISOTOPE = re.compile(r"\^\{(\d+)\}_\{(\d+)\}")
_CARET_CHARGE = re.compile(r"\^(\d+[+-])")
_STATE = re.compile(r"\((aq|s|g|l)\)")
_HYDRATE = re.compile(r"\s*\*\s*(\d*)H2O$")


def _parse_items(src: str, pos: int, closer: str | None) -> tuple[list, int]:
    items: list = []
    while pos < len(src):
        ch = src[pos]
        if closer and ch == closer:
            return items, pos
        if closer is None and (ch in "+^" or _STATE.match(src, pos)):
            break  # charge or state: the species-level caller handles it
        if ch == "-":
            nxt = src[pos + 1] if pos + 1 < len(src) else ""
            is_bond = bool(nxt) and (
                nxt.isupper() or (nxt in "([" and not _STATE.match(src, pos + 1))
            )
            if not is_bond:
                break  # trailing negative charge
            items.append(("bond", "-"))
            pos += 1
            continue
        if ch in "=#":
            items.append(("bond", ch))
            pos += 1
            continue
        if ch in "([":
            close = ")" if ch == "(" else "]"
            inner, end = _parse_items(src, pos + 1, close)
            if end >= len(src) or src[end] != close or not inner:
                raise ValueError(f"unclosed {ch!r} in {src!r}")
            pos = end + 1
            count = 1
            m = _DIGITS.match(src, pos)
            if m:
                count = int(m.group())
                pos = m.end()
            items.append(("grp", ch, tuple(inner), count))
            continue
        m = _ELEMENT.match(src, pos)
        if m:
            sym = m.group()
            pos = m.end()
            count = 1
            md = _DIGITS.match(src, pos)
            if md:
                count = int(md.group())
                pos = md.end()
            items.append(("el", sym, count))
            continue
        raise ValueError(f"unexpected {ch!r} at {pos} in {src!r}")
    if closer:
        raise ValueError(f"missing {closer!r} in {src!r}")
    return items, pos


def parse_species(text: str) -> Species:
    """'Ca(OH)2', '2H2O', 'SO4^2-', '^{235}_{92}U', 'CuSO4 * 5H2O' -> Species."""
    src = text.strip()
    hydrate = 0
    m = _HYDRATE.search(src)
    if m:
        hydrate = int(m.group(1) or "1")
        src = src[: m.start()]
    pos = 0
    coeff = 1
    m = _DIGITS.match(src)
    if m:
        coeff = int(m.group())
        pos = m.end()
    isotope = None
    m = _ISOTOPE.match(src, pos)
    if m:
        isotope = (int(m.group(1)), int(m.group(2)))
        pos = m.end()
    items, pos = _parse_items(src, pos, None)
    charge = ""
    m = _CARET_CHARGE.match(src, pos)
    if m:
        charge = m.group(1)
        pos = m.end()
    elif pos < len(src) and src[pos] in "+-":
        charge = src[pos]
        pos += 1
    state = ""
    m = _STATE.match(src, pos)
    if m:
        state = m.group(1)
        pos = m.end()
    if pos != len(src) or not items:
        raise ValueError(f"cannot parse species {text!r} (stopped at {pos})")
    return Species(coeff, isotope, tuple(items), charge, state, hydrate)


_ARROWS = ("<=>", "->", "<-")  # longest first


def parse_reaction(text: str) -> Reaction:
    for arrow in _ARROWS:
        sep = f" {arrow} "
        if sep in text:
            lhs_txt, rhs_txt = text.split(sep, 1)
            lhs = tuple(parse_species(s) for s in lhs_txt.split(" + "))
            rhs = tuple(parse_species(s) for s in rhs_txt.split(" + "))
            return Reaction(lhs, arrow, rhs)
    raise ValueError(f"no arrow in {text!r}")


# --------------------------------------------------------------------------
# rendering (structure -> the two output forms)

_ARROW_LATEX = {"->": "\\rightarrow ", "<=>": "\\rightleftharpoons ", "<-": "\\leftarrow "}
_BOND_LATEX = {"-": "-", "=": "=", "#": "\\equiv "}


def _items_latex(items: tuple) -> str:
    out = []
    for it in items:
        if it[0] == "el":
            _, sym, n = it
            out.append(sym + (f"_{{{n}}}" if n > 1 else ""))
        elif it[0] == "grp":
            _, br, inner, n = it
            op, cl = ("(", ")") if br == "(" else ("[", "]")
            out.append(op + _items_latex(inner) + cl + (f"_{{{n}}}" if n > 1 else ""))
        else:
            out.append(_BOND_LATEX[it[1]])
    return "".join(out)


def _items_ce(items: tuple) -> str:
    out = []
    for it in items:
        if it[0] == "el":
            _, sym, n = it
            out.append(sym + (str(n) if n > 1 else ""))
        elif it[0] == "grp":
            _, br, inner, n = it
            op, cl = ("(", ")") if br == "(" else ("[", "]")
            out.append(op + _items_ce(inner) + cl + (str(n) if n > 1 else ""))
        else:
            out.append(it[1])
    return "".join(out)


def species_latex(sp: Species) -> str:
    parts = []
    if sp.coeff != 1:
        parts.append(str(sp.coeff))
    if sp.isotope:
        parts.append(f"^{{{sp.isotope[0]}}}_{{{sp.isotope[1]}}}")
    parts.append(_items_latex(sp.items))
    if sp.charge:
        parts.append(f"^{{{sp.charge}}}")
    if sp.state:
        parts.append(f"({sp.state})")
    if sp.hydrate:
        n = str(sp.hydrate) if sp.hydrate > 1 else ""
        parts.append(f"\\cdot {n}H_{{2}}O")
    return "".join(parts)


def species_ce(sp: Species) -> str:
    parts = []
    if sp.coeff != 1:
        parts.append(str(sp.coeff))
    if sp.isotope:
        parts.append(f"^{{{sp.isotope[0]}}}_{{{sp.isotope[1]}}}")
    parts.append(_items_ce(sp.items))
    if sp.charge:
        parts.append(sp.charge if sp.charge in "+-" else f"^{sp.charge}")
    if sp.state:
        parts.append(f"({sp.state})")
    if sp.hydrate:
        n = str(sp.hydrate) if sp.hydrate > 1 else ""
        parts.append(f" * {n}H2O")
    return "".join(parts)


def reaction_latex(rx: Reaction) -> str:
    lhs = "+".join(species_latex(s) for s in rx.lhs)
    rhs = "+".join(species_latex(s) for s in rx.rhs)
    return (lhs + _ARROW_LATEX[rx.arrow] + rhs).strip()


def reaction_ce(rx: Reaction) -> str:
    lhs = " + ".join(species_ce(s) for s in rx.lhs)
    rhs = " + ".join(species_ce(s) for s in rx.rhs)
    return f"{lhs} {rx.arrow} {rhs}"


def entry_from_source(text: str) -> Entry:
    """mhchem-like source text -> Entry with both forms rendered from structure."""
    if any(f" {a} " in text for a in _ARROWS):
        rx = parse_reaction(text)
        return Entry(latex=reaction_latex(rx), ce=reaction_ce(rx))
    sp = parse_species(text)
    return Entry(latex=species_latex(sp).strip(), ce=species_ce(sp))


def check_entry(entry: Entry) -> bool:
    """The consistency gate: the serving layer must map latex to exactly ce."""
    return latex_to_ce(entry.latex) == entry.ce


# --------------------------------------------------------------------------
# (a) curated real chemistry

_CURATED_SRC = [
    # combustion / oxidation
    "2H2 + O2 -> 2H2O",
    "CH4 + 2O2 -> CO2 + 2H2O",
    "C3H8 + 5O2 -> 3CO2 + 4H2O",
    "2C2H6 + 7O2 -> 4CO2 + 6H2O",
    "C2H5OH + 3O2 -> 2CO2 + 3H2O",
    "C6H12O6 + 6O2 -> 6CO2 + 6H2O",
    "2Mg + O2 -> 2MgO",
    "4Fe + 3O2 -> 2Fe2O3",
    "4Al + 3O2 -> 2Al2O3",
    "S + O2 -> SO2",
    "C + O2 -> CO2",
    "2CO + O2 -> 2CO2",
    # neutralization / acid-base
    "NaOH + HCl -> NaCl + H2O",
    "H2SO4 + 2NaOH -> Na2SO4 + 2H2O",
    "HNO3 + KOH -> KNO3 + H2O",
    "Ca(OH)2 + 2HCl -> CaCl2 + 2H2O",
    "H3PO4 + 3NaOH -> Na3PO4 + 3H2O",
    "NH3 + HCl -> NH4Cl",
    "CaCO3 + 2HCl -> CaCl2 + H2O + CO2",
    "2HCl + Na2CO3 -> 2NaCl + H2O + CO2",
    # redox / displacement
    "Zn + 2HCl -> ZnCl2 + H2",
    "Mg + 2HCl -> MgCl2 + H2",
    "Fe + CuSO4 -> FeSO4 + Cu",
    "Zn + CuSO4 -> ZnSO4 + Cu",
    "Cu + 2AgNO3 -> Cu(NO3)2 + 2Ag",
    "2Al + 3CuCl2 -> 2AlCl3 + 3Cu",
    "2Na + 2H2O -> 2NaOH + H2",
    "2K + 2H2O -> 2KOH + H2",
    "Fe2O3 + 3CO -> 2Fe + 3CO2",
    "MnO2 + 4HCl -> MnCl2 + Cl2 + 2H2O",
    "2Na(s) + Cl2(g) -> 2NaCl(s)",
    # precipitation
    "AgNO3 + NaCl -> AgCl + NaNO3",
    "NaCl(aq) + AgNO3(aq) -> AgCl(s) + NaNO3(aq)",
    "BaCl2 + Na2SO4 -> BaSO4 + 2NaCl",
    "Pb(NO3)2 + 2KI -> PbI2 + 2KNO3",
    "CaCl2 + Na2CO3 -> CaCO3 + 2NaCl",
    "CuSO4 + 2NaOH -> Cu(OH)2 + Na2SO4",
    "FeCl3 + 3NaOH -> Fe(OH)3 + 3NaCl",
    "AgNO3 + KBr -> AgBr + KNO3",
    # decomposition / synthesis / equilibria
    "CaCO3 -> CaO + CO2",
    "2H2O2 -> 2H2O + O2",
    "2KClO3 -> 2KCl + 3O2",
    "2H2O -> 2H2 + O2",
    "NH4Cl -> NH3 + HCl",
    "N2 + 3H2 <=> 2NH3",
    "2SO2 + O2 <=> 2SO3",
    "H2 + I2 <=> 2HI",
    "N2O4 <=> 2NO2",
    "CO2 + H2O <=> H2CO3",
    "2H2O <=> H3O+ + OH-",
    "NH3 + H2O <=> NH4+ + OH-",
    "HCl(aq) -> H+(aq) + Cl-(aq)",
    # hydrates
    "CuSO4 * 5H2O",
    "Na2CO3 * 10H2O",
    "MgSO4 * 7H2O",
    "CaSO4 * 2H2O",
    # common ions
    "SO4^2-",
    "Fe^3+",
    "Fe^2+",
    "Cu^2+",
    "Al^3+",
    "Ag+",
    "Zn^2+",
    "NH4+",
    "OH-",
    "NO3-",
    "HCO3-",
    "CO3^2-",
    "PO4^3-",
    "MnO4-",
    "Cr2O7^2-",
    "H3O+",
    # isotopes / nuclear
    "^{235}_{92}U",
    "^{238}_{92}U",
    "^{14}_{6}C",
    "^{3}_{1}H",
    "^{4}_{2}He",
    "^{60}_{27}Co",
    "^{131}_{53}I",
    "^{238}_{92}U -> ^{234}_{90}Th + ^{4}_{2}He",
    # complexes
    "[Fe(CN)6]^3-",
    "[Cu(NH3)4]^2+",
    "[Ag(NH3)2]+",
    # bond notation
    "N#N",
    "O=C=O",
    "CH2=CH2",
    "CH3-CH3",
    "HC#CH",
    "CH3-CH2-OH",
]


def curated_entries() -> list[Entry]:
    entries = []
    for src in _CURATED_SRC:
        entry = entry_from_source(src)
        assert check_entry(entry), f"curated entry fails the gate: {src!r} -> {entry}"
        entries.append(entry)
    return entries


# --------------------------------------------------------------------------
# (b) seeded random generator over real ion tables

_CATIONS = [  # (formula, charge, weight)
    ("H", 1, 4), ("Li", 1, 2), ("Na", 1, 6), ("K", 1, 5), ("Ag", 1, 3),
    ("NH4", 1, 3), ("Mg", 2, 4), ("Ca", 2, 5), ("Ba", 2, 3), ("Sr", 2, 1),
    ("Fe", 2, 3), ("Fe", 3, 3), ("Cu", 2, 4), ("Zn", 2, 3), ("Al", 3, 3),
    ("Pb", 2, 2), ("Mn", 2, 2), ("Ni", 2, 2), ("Cr", 3, 1), ("Sn", 2, 1),
]
_ANIONS = [
    ("F", 1, 2), ("Cl", 1, 6), ("Br", 1, 3), ("I", 1, 3), ("OH", 1, 4),
    ("NO3", 1, 5), ("HCO3", 1, 2), ("ClO3", 1, 1), ("ClO4", 1, 1),
    ("MnO4", 1, 2), ("CN", 1, 1), ("O", 2, 4), ("S", 2, 3), ("SO4", 2, 5),
    ("SO3", 2, 2), ("CO3", 2, 4), ("CrO4", 2, 1), ("PO4", 3, 3), ("N", 3, 1),
]
# H+OH would render as "HOH", H+N as "H3N", H+HCO3 as "HHCO3" (carbonic acid
# is H2CO3, not a 1:1 H/HCO3 salt) and NH4+O as the nonexistent "(NH4)2O" —
# skip the nonsense pairs (H+O deliberately stays: it composes to plain H2O).
_BAD_PAIRS = {("H", "OH"), ("H", "N"), ("H", "HCO3"), ("NH4", "O")}

_ISOTOPE_TABLE = [  # (element, Z, common mass numbers)
    ("H", 1, [1, 2, 3]), ("C", 6, [12, 13, 14]), ("N", 7, [14, 15]),
    ("O", 8, [16, 18]), ("Na", 11, [22, 23]), ("P", 15, [31, 32]),
    ("S", 16, [32, 35]), ("Cl", 17, [35, 37]), ("K", 19, [39, 40]),
    ("Ca", 20, [40, 44]), ("Fe", 26, [56, 59]), ("Co", 27, [59, 60]),
    ("Sr", 38, [88, 90]), ("I", 53, [127, 131]), ("Cs", 55, [133, 137]),
    ("Pb", 82, [206, 208]), ("Ra", 88, [226]), ("Th", 90, [230, 232]),
    ("U", 92, [233, 235, 238]), ("Pu", 94, [239]),
]


def _pick(rng: random.Random, table: list) -> tuple[str, int]:
    row = rng.choices(table, weights=[w for _, _, w in table])[0]
    return row[0], row[1]


def _is_single_element(sym: str) -> bool:
    return _ELEMENT.fullmatch(sym) is not None


def _unit(sym: str, n: int) -> str:
    if n == 1:
        return sym
    return f"{sym}{n}" if _is_single_element(sym) else f"({sym}){n}"


def _salt(cation: tuple[str, int], anion: tuple[str, int]) -> str | None:
    (cs, cq), (asym, aq) = cation, anion
    if (cs, asym) in _BAD_PAIRS:
        return None
    g = gcd(cq, aq)
    return _unit(cs, aq // g) + _unit(asym, cq // g)


def _c(n: int) -> str:
    return "" if n == 1 else str(n)


def _r_formula(rng: random.Random) -> str | None:
    salt = _salt(_pick(rng, _CATIONS), _pick(rng, _ANIONS))
    if salt is None:
        return None
    if rng.random() < 0.18:
        salt = f"{rng.randint(2, 4)}{salt}"
    if rng.random() < 0.22:
        salt += f"({rng.choice(['aq', 's', 'aq', 'aq', 's', 'l'])})"
    return salt


def _r_ion(rng: random.Random) -> str:
    if rng.random() < 0.5:
        sym, q = _pick(rng, _CATIONS)
        return f"{sym}+" if q == 1 else f"{sym}^{q}+"
    sym, q = _pick(rng, _ANIONS)
    return f"{sym}-" if q == 1 else f"{sym}^{q}-"


def _r_isotope(rng: random.Random) -> str:
    sym, z, masses = rng.choice(_ISOTOPE_TABLE)
    return f"^{{{rng.choice(masses)}}}_{{{z}}}{sym}"


def _r_hydrate(rng: random.Random) -> str | None:
    cation = _pick(rng, [r for r in _CATIONS if r[0] not in ("H", "NH4")])
    anion = _pick(rng, [r for r in _ANIONS if r[0] in ("SO4", "CO3", "Cl", "NO3")])
    salt = _salt(cation, anion)
    if salt is None:
        return None
    return f"{salt} * {rng.choice([2, 3, 4, 5, 6, 7, 10])}H2O"


def _r_double(rng: random.Random) -> str | None:
    """Double displacement AX + BY -> AY + BX, charge-matched so 1:1:1:1 balances."""
    q = rng.choice([1, 1, 1, 2])
    cats = [r for r in _CATIONS if r[1] == q]
    aq = rng.choice([1, 1, 2])  # ONE draw — a per-anion draw mixes charges and breaks 1:1:1:1 balance
    ans = [r for r in _ANIONS if r[1] == aq]
    if len(cats) < 2 or len(ans) < 2:
        return None
    (a, b), (x, y) = rng.sample(cats, 2), rng.sample(ans, 2)
    salts = [_salt(a[:2], x[:2]), _salt(b[:2], y[:2]), _salt(a[:2], y[:2]), _salt(b[:2], x[:2])]
    if any(s is None for s in salts):
        return None
    arrow = "<=>" if rng.random() < 0.1 else "->"
    return f"{salts[0]} + {salts[1]} {arrow} {salts[2]} + {salts[3]}"


def _r_synthesis(rng: random.Random) -> str | None:
    """Balanced metal + diatomic nonmetal -> salt."""
    metal = _pick(rng, [r for r in _CATIONS if r[0] not in ("H", "NH4")])
    x, xq = rng.choice([("O", 2), ("Cl", 1), ("Br", 1), ("I", 1), ("N", 3)])
    salt = _salt(metal, (x, xq))
    if salt is None:
        return None
    g = gcd(metal[1], xq)
    nc, na = xq // g, metal[1] // g  # per formula unit
    k = 1 if na % 2 == 0 else 2
    return f"{_c(nc * k)}{metal[0]} + {_c(na * k // 2)}{x}2 -> {_c(k)}{salt}"


def _r_decomposition(rng: random.Random) -> str:
    m = rng.choice(["Ca", "Mg", "Ba", "Zn", "Cu", "Pb", "Fe", "Ni", "Mn"])
    if rng.random() < 0.5:
        return f"{m}CO3 -> {m}O + CO2"
    return f"{m}(OH)2 -> {m}O + H2O"


_MODES = [
    (_r_formula, 28), (_r_ion, 16), (_r_isotope, 10), (_r_hydrate, 10),
    (_r_double, 20), (_r_synthesis, 10), (_r_decomposition, 6),
]


def random_entries(n: int, seed: int = 0, exclude: set[str] | frozenset = frozenset()) -> list[Entry]:
    """n unique gate-checked random entries; deterministic in (n, seed, exclude)."""
    rng = random.Random(seed)
    seen: set[str] = set(exclude)
    out: list[Entry] = []
    builders = [b for b, _ in _MODES]
    weights = [w for _, w in _MODES]
    attempts = 0
    while len(out) < n:
        attempts += 1
        if attempts > 200 * max(n, 1):
            raise RuntimeError(f"random_entries stalled at {len(out)}/{n}")
        src = rng.choices(builders, weights=weights)[0](rng)
        if not src or src in seen:
            continue
        try:
            entry = entry_from_source(src)
        except ValueError:
            continue
        if not check_entry(entry):  # consistency gate: drop, never emit
            continue
        seen.add(src)
        out.append(entry)
    return out


def build_corpus(n: int, seed: int = 0, curated_only: bool = False) -> list[Entry]:
    """n entries: all curated first, topped up with random ones, shuffled by seed."""
    base = curated_entries()
    if curated_only:
        entries = [base[i % len(base)] for i in range(n)]
    else:
        entries = list(base)
        if n > len(entries):
            entries += random_entries(n - len(entries), seed, exclude={e.ce for e in entries})
        random.Random(seed).shuffle(entries)
        entries = entries[:n]
    for e in entries:
        assert check_entry(e), f"corpus entry fails the gate: {e}"
    return entries


if __name__ == "__main__":
    ok = True

    # the documented example must come out EXACTLY in MathWriting convention
    demo = entry_from_source("2H2 + O2 -> 2H2O")
    for got, want in [
        (demo.latex, r"2H_{2}+O_{2}\rightarrow 2H_{2}O"),
        (demo.ce, "2H2 + O2 -> 2H2O"),
    ]:
        mark = "✓" if got == want else "✗"
        ok &= got == want
        print(f"{mark} {got!r}" + ("" if got == want else f"   (wanted {want!r})"))

    curated = curated_entries()  # asserts the gate internally
    print(f"✓ curated: {len(curated)} entries, all pass the consistency gate")
    assert not any("\\frac" in e.latex for e in curated)

    rand = random_entries(500, seed=123)
    assert all(check_entry(e) for e in rand)
    assert len({e.ce for e in rand}) == len(rand)
    print(f"✓ random:  {len(rand)} unique entries, all pass the consistency gate")
    assert not any("\\frac" in e.latex for e in rand)

    assert random_entries(50, seed=9) == random_entries(50, seed=9)
    assert build_corpus(120, seed=7) == build_corpus(120, seed=7)
    assert [e.ce for e in build_corpus(10, seed=7, curated_only=True)] == [
        e.ce for e in curated[:10]
    ]
    print("✓ deterministic: same seed -> identical corpus")

    for e in curated[:3] + rand[:5]:
        print(f"   {e.ce!r:48s} <- {e.latex!r}")
    raise SystemExit(0 if ok else 1)
