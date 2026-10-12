"""Colors and parts the engine is allowed to use (the BrickWish palette).

Designs may only use these, so every model can be picked by our supplier and is covered by our
lab-tested element library. BrickLink color IDs must be checked against the supplier's chart
before the first order; suppliers map them to their own (e.g. Gobricks GDS) numbers.
"""

# name: (hex for renders, BrickLink color id, BrickLink color name, English, Spanish)
COLORS = {
    "red":       ("#C91A09", 5,   "Red",                "Red",        "Rojo"),
    "orange":    ("#FE8A18", 4,   "Orange",             "Orange",     "Naranja"),
    "yellow":    ("#F2CD37", 3,   "Yellow",             "Yellow",     "Amarillo"),
    "lime":      ("#BBE90B", 34,  "Lime",               "Lime",       "Lima"),
    "green":     ("#237841", 6,   "Green",              "Green",      "Verde"),
    "azure":     ("#36AEBF", 156, "Medium Azure",       "Sky blue",   "Celeste"),
    "blue":      ("#0055BF", 7,   "Blue",               "Blue",       "Azul"),
    "purple":    ("#7A3FB8", 89,  "Dark Purple",        "Purple",     "Morado"),
    "pink":      ("#F48FB1", 104, "Bright Pink",        "Pink",       "Rosado"),
    "brown":     ("#6B4226", 88,  "Reddish Brown",      "Brown",      "Café"),
    "tan":       ("#E4CD9E", 2,   "Tan",                "Tan",        "Beige"),
    "gray":      ("#A0A5A9", 86,  "Light Bluish Gray",  "Gray",       "Gris"),
    "dark_gray": ("#6C6E68", 85,  "Dark Bluish Gray",   "Dark gray",  "Gris oscuro"),
    "white":     ("#F4F4F4", 1,   "White",              "White",      "Blanco"),
    "black":     ("#1E1E24", 11,  "Black",              "Black",      "Negro"),
}

# Plain bricks, keyed by (short side, long side) in studs -> (LEGO design id, name)
BRICKS = {
    (1, 1): ("3005", "Brick 1 x 1"),
    (1, 2): ("3004", "Brick 1 x 2"),
    (1, 3): ("3622", "Brick 1 x 3"),
    (1, 4): ("3010", "Brick 1 x 4"),
    (1, 6): ("3009", "Brick 1 x 6"),
    (1, 8): ("3008", "Brick 1 x 8"),
    (2, 2): ("3003", "Brick 2 x 2"),
    (2, 3): ("3002", "Brick 2 x 3"),
    (2, 4): ("3001", "Brick 2 x 4"),
    (2, 6): ("2456", "Brick 2 x 6"),
    (2, 8): ("3007", "Brick 2 x 8"),
}

# Special one-layer elements a design can place directly: kind -> (design id, name, footprint)
SPECIAL = {
    "round1x1": ("3062b", "Brick, Round 1 x 1", 1),
    "cone1x1":  ("4589",  "Cone 1 x 1", 1),
    "round2x2": ("3941",  "Brick, Round 2 x 2", 2),
}

# Age rules used when splitting the build into steps and pages (see AI_PIPELINE.md §5)
AGE_RULES = {
    "4-6":   {"parts_per_step": 3,  "steps_per_page": 1, "merge_layers": False},
    "7-9":   {"parts_per_step": 5,  "steps_per_page": 2, "merge_layers": False},
    "10-12": {"parts_per_step": 8,  "steps_per_page": 2, "merge_layers": True},
    "13+":   {"parts_per_step": 12, "steps_per_page": 4, "merge_layers": True},
}

TIERS = {
    "mini":   (80, 150),
    "medium": (200, 350),
    "big":    (400, 650),
    "mega":   (800, 1200),
}


def hex_of(color):
    return COLORS[color][0]
