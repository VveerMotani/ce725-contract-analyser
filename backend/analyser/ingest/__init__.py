"""M1 ingest: package intake (F1), page parsing (F2), visual triggers (F3), page rendering.

Public functions (see INTERFACES.md):
    build_package, load_package, benchmark_package, render_page_png
Extra helpers: dev_package, find_quote_rects, parse_document.
"""
from .package import benchmark_package, build_package, dev_package, load_package, package_dir
from .parse import parse_document
from .render import find_quote_rects, render_page_png

__all__ = ["build_package", "load_package", "benchmark_package", "dev_package",
           "render_page_png", "find_quote_rects", "parse_document", "package_dir"]
