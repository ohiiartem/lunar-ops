"""Text conclusion for /api/compare. Built from the numbers by fixed rules; nothing is hand-written."""

THRESHOLD_H = 0.5  # differences smaller than this are reported as "about the same"


def _h(x):
    """Hours with one decimal, whole numbers without ".0" (70 h, 63.5 h)."""
    return f"{abs(x):.1f}".removesuffix(".0")


def _phrase(delta, what):
    if abs(delta) < THRESHOLD_H:
        return f"about the same {what}"
    return f"{_h(delta)} h {'more' if delta > 0 else 'less'} {what}"


def summarize(delta):
    light, earth = delta["light_hours"], delta["earth_visible_hours"]
    similar = abs(light) < THRESHOLD_H or abs(earth) < THRESHOLD_H
    joiner = "and" if similar or (light > 0) == (earth > 0) else "but"
    text = (
        f"Scenario B has {_phrase(light, 'potential sunlight')} {joiner} "
        f"{_phrase(earth, 'geometric Earth visibility')} than scenario A."
    )
    dark = delta["longest_darkness_hours"]
    if abs(dark) >= 1.0:
        text += f" Its longest dark period is {_h(dark)} h {'longer' if dark > 0 else 'shorter'}."
    return text
