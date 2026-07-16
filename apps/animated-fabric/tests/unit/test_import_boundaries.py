from __future__ import annotations

import ast
import sys
from pathlib import Path


def test_pyside6_is_confined_to_gui_package() -> None:
    source_root = Path(__file__).resolve().parents[2] / "src" / "animated_fabric"
    violations: list[str] = []

    for source_path in sorted(source_root.rglob("*.py")):
        relative_path = source_path.relative_to(source_root)
        if relative_path.parts[0] == "gui":
            continue

        tree = ast.parse(source_path.read_text(encoding="utf-8"), filename=str(relative_path))
        for node in ast.walk(tree):
            if isinstance(node, ast.Import):
                imported_modules = (alias.name for alias in node.names)
            elif isinstance(node, ast.ImportFrom) and node.module is not None:
                imported_modules = (node.module,)
            else:
                continue

            if any(
                module == "PySide6" or module.startswith("PySide6.") for module in imported_modules
            ):
                violations.append(f"{relative_path.as_posix()}:{node.lineno}")

    assert violations == []


def test_domain_uses_only_standard_library_pydantic_and_first_party_imports() -> None:
    domain_root = Path(__file__).resolve().parents[2] / "src" / "animated_fabric" / "domain"
    allowed_roots = {*sys.stdlib_module_names, "animated_fabric", "pydantic"}
    violations: list[str] = []

    for source_path in sorted(domain_root.rglob("*.py")):
        relative_path = source_path.relative_to(domain_root)
        tree = ast.parse(source_path.read_text(encoding="utf-8"), filename=str(relative_path))
        for node in ast.walk(tree):
            if isinstance(node, ast.Import):
                imported_modules = (alias.name for alias in node.names)
            elif isinstance(node, ast.ImportFrom) and node.module is not None:
                imported_modules = (node.module,)
            else:
                continue

            for module in imported_modules:
                if module.split(".", maxsplit=1)[0] not in allowed_roots:
                    violations.append(f"{relative_path.as_posix()}:{node.lineno}:{module}")

    assert violations == []


def test_application_layer_is_image_library_neutral() -> None:
    application_root = (
        Path(__file__).resolve().parents[2] / "src" / "animated_fabric" / "application"
    )
    forbidden_roots = {"PIL", "cv2", "numpy"}
    violations: list[str] = []

    for source_path in sorted(application_root.rglob("*.py")):
        relative_path = source_path.relative_to(application_root)
        tree = ast.parse(source_path.read_text(encoding="utf-8"), filename=str(relative_path))
        for node in ast.walk(tree):
            if isinstance(node, ast.Import):
                imported_modules = (alias.name for alias in node.names)
            elif isinstance(node, ast.ImportFrom) and node.module is not None:
                imported_modules = (node.module,)
            else:
                continue

            for module in imported_modules:
                if module.split(".", maxsplit=1)[0] in forbidden_roots:
                    violations.append(f"{relative_path.as_posix()}:{node.lineno}:{module}")

    assert violations == []
