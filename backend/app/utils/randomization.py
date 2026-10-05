import random
import secrets


def shuffled(items, seed: int, salt: str) -> list:
    """Same seed+salt -> same order. Input list mutate nahi hoti."""
    out = list(items)
    random.Random(f"{seed}:{salt}").shuffle(out)
    return out


def new_seed() -> int:
    return secrets.randbelow(2**31)
