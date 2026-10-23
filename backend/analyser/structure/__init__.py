"""M1 structure: document map (F4) and clause-type retrieval (F5).

Public API (see INTERFACES.md):
    build_document_map, retrieve, find_pages, resolve_pointer, TERM_LISTS
"""
from .docmap import build_document_map
from .retrieve import find_pages, resolve_pointer, retrieve
from .terms import TERM_LISTS

__all__ = ["build_document_map", "retrieve", "find_pages", "resolve_pointer", "TERM_LISTS"]
