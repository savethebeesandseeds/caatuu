"""Application lifecycle for the minimal PySide6 shell."""

from __future__ import annotations

import sys
from collections.abc import Sequence

from PySide6.QtWidgets import QApplication

from animated_fabric.gui.main_window import MainWindow


def create_application(arguments: Sequence[str] | None = None) -> QApplication:
    """Return the current Qt application or create one for this process."""
    current = QApplication.instance()
    if isinstance(current, QApplication):
        return current
    return QApplication(list(arguments) if arguments is not None else sys.argv)


def main() -> int:
    """Open the M0 desktop shell and run the Qt event loop."""
    application = create_application()
    window = MainWindow()
    window.show()
    return application.exec()
