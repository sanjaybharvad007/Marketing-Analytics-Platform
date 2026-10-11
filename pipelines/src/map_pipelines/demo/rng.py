"""Stateless pseudo-randomness.

Every draw is a pure function of (seed, key parts), so the value generated for
a given entity and date never depends on which window is being generated or in
what order. That is what makes demo backfills and re-pulls reproduce the same
rows.
"""

from __future__ import annotations

import math
from hashlib import blake2b

_SCALE = float(1 << 64)


def uniform(seed: int, *parts: object) -> float:
    """Uniform float in [0, 1) derived from the seed and key parts."""
    key = "|".join(str(part) for part in (seed, *parts)).encode("utf-8")
    return int.from_bytes(blake2b(key, digest_size=8).digest(), "big") / _SCALE


def between(seed: int, low: float, high: float, *parts: object) -> float:
    return low + (high - low) * uniform(seed, *parts)


def gauss(seed: int, *parts: object) -> float:
    """Standard normal draw (Box-Muller on two derived uniforms)."""
    u1 = max(uniform(seed, *parts, "a"), 1e-12)
    u2 = uniform(seed, *parts, "b")
    return math.sqrt(-2.0 * math.log(u1)) * math.cos(2.0 * math.pi * u2)


def noise(seed: int, sigma: float, *parts: object) -> float:
    """Multiplicative log-normal noise centred on 1."""
    return math.exp(sigma * gauss(seed, *parts))


def stochastic_round(seed: int, value: float, *parts: object) -> int:
    """Round up with probability equal to the fractional part.

    Keeps expected totals intact for small values, which a plain round() would
    flatten to zero.
    """
    if value <= 0:
        return 0
    floor = math.floor(value)
    return floor + (1 if uniform(seed, *parts, "r") < value - floor else 0)


def choice(seed: int, options: list | tuple, *parts: object):
    return options[int(uniform(seed, *parts) * len(options)) % len(options)]
