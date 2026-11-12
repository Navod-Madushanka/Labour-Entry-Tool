"""What an activity code means, in words: "03-11-00-00-P" is Concrete Forming.

The site's codes follow MasterFormat (CSI/CSC) numbering in their first three pairs: ``03-11-00``
is section 03 11 00 Concrete Forming, ``03-20-00`` Concrete Reinforcing. The standard titles below
seed a description for every code; the office overrides any of them per project (kept with the
place names). A code whose numbers are not in the list falls back to its broader section and then
its division, so ``03-31-05-35`` reads "Structural Concrete".
"""

from __future__ import annotations

import re

from app.domain.medical import DEFAULT_ACTIVITY

# MasterFormat divisions (two digits) and the sections the sites use most (six digits).
DIVISIONS = {
    "00": "Procurement and Contracting",
    "01": "General Requirements",
    "02": "Existing Conditions",
    "03": "Concrete",
    "04": "Masonry",
    "05": "Metals",
    "06": "Wood, Plastics and Composites",
    "07": "Thermal and Moisture Protection",
    "08": "Openings",
    "09": "Finishes",
    "10": "Specialties",
    "11": "Equipment",
    "12": "Furnishings",
    "13": "Special Construction",
    "14": "Conveying Equipment",
    "21": "Fire Suppression",
    "22": "Plumbing",
    "23": "HVAC",
    "26": "Electrical",
    "27": "Communications",
    "28": "Electronic Safety and Security",
    "31": "Earthwork",
    "32": "Exterior Improvements",
    "33": "Utilities",
    "34": "Transportation",
    "35": "Waterway and Marine Construction",
}

SECTIONS = {
    "010000": "General Requirements",
    "015000": "Temporary Facilities and Controls",
    "017000": "Execution and Closeout",
    "017400": "Cleaning and Waste Management",
    "020000": "Existing Conditions",
    "024100": "Demolition",
    "030000": "Concrete",
    "030500": "Common Work Results for Concrete",
    "031000": "Concrete Forming and Accessories",
    "031100": "Concrete Forming",
    "031500": "Concrete Accessories",
    "032000": "Concrete Reinforcing",
    "032100": "Reinforcement Bars",
    "032200": "Fabric and Grid Reinforcing",
    "032300": "Stressed Tendon Reinforcing",
    "033000": "Cast-in-Place Concrete",
    "033100": "Structural Concrete",
    "033300": "Architectural Concrete",
    "033500": "Concrete Finishing",
    "033700": "Specialty Placed Concrete",
    "033800": "Post-Tensioned Concrete",
    "033900": "Concrete Curing",
    "034000": "Precast Concrete",
    "034100": "Precast Structural Concrete",
    "034500": "Precast Architectural Concrete",
    "035000": "Cast Decks and Underlayment",
    "036000": "Grouting",
    "037000": "Mass Concrete",
    "038000": "Concrete Cutting and Boring",
    "040000": "Masonry",
    "042000": "Unit Masonry",
    "042200": "Concrete Unit Masonry",
    "050000": "Metals",
    "051200": "Structural Steel Framing",
    "055000": "Metal Fabrications",
    "060000": "Wood, Plastics and Composites",
    "061000": "Rough Carpentry",
    "062000": "Finish Carpentry",
    "070000": "Thermal and Moisture Protection",
    "071000": "Dampproofing and Waterproofing",
    "080000": "Openings",
    "090000": "Finishes",
    "092000": "Plaster and Gypsum Board",
    "092400": "Cement Plastering",
    "093000": "Tiling",
    "096000": "Flooring",
    "099000": "Painting and Coating",
    "310000": "Earthwork",
    "311000": "Site Clearing",
    "312000": "Earth Moving",
    "312200": "Grading",
    "312300": "Excavation and Fill",
    "312316": "Excavation",
    "312323": "Fill",
    "313000": "Earthwork Methods",
    "314000": "Shoring and Underpinning",
    "315000": "Excavation Support and Protection",
    "316000": "Special Foundations and Load-Bearing Elements",
    "316200": "Driven Piles",
    "316300": "Bored Piles",
    "320000": "Exterior Improvements",
    "321000": "Bases, Ballasts and Paving",
    "330000": "Utilities",
}

# Codes the tool itself uses, which are not MasterFormat sections.
OWN = {DEFAULT_ACTIVITY: "Medical leave"}

_PAIRS = re.compile(r"^(\d\d)-(\d\d)-(\d\d)(?:-|$)")


def standard_description(code: str) -> str | None:
    """The MasterFormat title for a code, from the most specific level known; None when the code
    does not start with three number pairs or its division is unknown."""
    code = code.strip()
    if code in OWN:
        return OWN[code]
    m = _PAIRS.match(code)
    if not m:
        return None
    div, sec, sub = m.groups()
    for key in (div + sec + sub, div + sec + "00", div + sec[0] + "000"):
        if key in SECTIONS:
            return SECTIONS[key]
    return DIVISIONS.get(div)


def descriptions(codes: list[str], custom: dict[str, str]) -> dict[str, str]:
    """Each code's description: the office's own, else the standard title (codes with neither
    are left out)."""
    out: dict[str, str] = {}
    for code in codes:
        text = custom.get(code) or standard_description(code)
        if text:
            out[code] = text
    return out
