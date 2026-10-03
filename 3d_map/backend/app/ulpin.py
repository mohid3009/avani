"""
3D ULPIN generation.

Base ULPIN: a deterministic mock 14-digit number derived from the building id
(format `XX-DD-DDDD-DDDD-DDDD`, e.g. `TN-07-4821-9034-7756`) — the same building
always yields the same base ULPIN.

Unit ULPIN: `{base}-F{floor}-U{unit}` — floor_index is negative for basements
(F-1, F-2), matching the PRD (FR2/FR3).
"""
import hashlib

# demo owner registry (deterministic assignment from the unit's ULPIN hash)
OWNERS = [
    ("OWN-0001", "Citizen 1"),
    ("OWN-0002", "Priya Venkatesan"),
    ("OWN-0003", "Arun Krishnan"),
    ("OWN-0004", "Lakshmi Narayanan"),
    ("OWN-0005", "Fatima Beevi"),
    ("OWN-0006", "Vikram Chandra"),
    ("OWN-0007", "Ananya Sharma"),
    ("OWN-0008", "Mohan Das"),
    ("OWN-0009", "Kavitha Raman"),
    ("OWN-0010", "Suresh Pillai"),
    ("OWN-0011", "Divya Krishnamurthy"),
    ("OWN-0012", "Rahul Verma"),
]

RIGHTS_FLOOR = ("owned", "owned", "leased", "owned", "common")
RIGHTS_BASEMENT = ("leased", "common")


def _digest(text):
    return hashlib.sha256(str(text).encode("utf-8")).hexdigest()


def base_ulpin(building_id):
    """Deterministic mock 14-digit base ULPIN: XX-DD-DDDD-DDDD-DDDD."""
    h = _digest(building_id)
    letters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ"
    a = letters[int(h[0], 16) % 26] + letters[int(h[1], 16) % 26]
    digits = "".join(str(int(c, 16) % 10) for c in h[2:16])
    return f"{a}-{digits[0:2]}-{digits[2:6]}-{digits[6:10]}-{digits[10:14]}"


_ALNUM = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ"


def _mod_37_36(chars):
    """ISO 7064 hybrid MOD 37,36 running remainder over alphanumerics (others ignored)."""
    p = 36
    for c in chars.upper():
        if c in _ALNUM:
            s = (_ALNUM.index(c) + p) % 36 or 36
            p = (s * 2) % 37
    return p


def check_char(code):
    """Check character that catches any single typo or adjacent swap in `code`."""
    return _ALNUM[(37 - _mod_37_36(code)) % 36]


def is_valid(code_with_check):
    """True when the trailing check character matches (the running remainder lands on 2)."""
    return _mod_37_36(code_with_check) == 2


def with_check(ulpin):
    return f"{ulpin}-{check_char(ulpin)}"


def split_check(code):
    """'<ulpin>-<c>' -> (ulpin, c); c is None when no one-character suffix is present."""
    head, _, tail = (code or "").strip().upper().rpartition("-")
    return (head, tail) if head and len(tail) == 1 else ((code or "").strip().upper(), None)


def unit_ulpin(base, floor_index, unit_no):
    return f"{base}-F{floor_index}-U{unit_no}"


FIRST = ("Asha", "Bala", "Chitra", "Dev", "Esha", "Farhan", "Geeta", "Hari", "Indu", "Jai", "Kiran", "Latha", "Manoj", "Nila", "Om", "Padma")
LAST = ("Nair", "Reddy", "Gupta", "Menon", "Shah", "Khan", "Pillai", "Joshi", "Rao", "Bose", "Das", "Mehta")


def owner_for(ulpin, floor_index):
    """Deterministic demo owner + rights type for a unit.

    About 2 % of units go to the 12 named demo citizens (so each holds a handful,
    like a real person); the rest get a generated owner of their own.
    """
    h = _digest(ulpin)
    n = int(h[0:4], 16) % 1000
    if n < 19:
        owner_id, name = OWNERS[n % len(OWNERS)]
    else:
        owner_id = f"OWN-{1000 + int(h[8:12], 16) % 9000}"
        name = f"{FIRST[int(h[12:14], 16) % len(FIRST)]} {LAST[int(h[14:16], 16) % len(LAST)]}"
    if floor_index < 0:
        rights = RIGHTS_BASEMENT[int(h[4:8], 16) % len(RIGHTS_BASEMENT)]
    else:
        rights = RIGHTS_FLOOR[int(h[4:8], 16) % len(RIGHTS_FLOOR)]
    return {"owner_id": owner_id, "owner_name": name, "rights_type": rights}
