"""vero — evidence-first reverse engineering.

Take apart software you own or are authorized to analyze, and get back claims
that each carry their evidence, confidence and residual unknowns, sealed under
a verifiable root hash.
"""

from .evidence import (
    Ledger, Evidence, Finding, Artifact, Locator, Confidence, Unknown,
)
from . import analysis

__version__ = "0.1.0"
__all__ = ["Ledger", "Evidence", "Finding", "Artifact", "Locator",
           "Confidence", "Unknown", "analysis", "__version__"]
