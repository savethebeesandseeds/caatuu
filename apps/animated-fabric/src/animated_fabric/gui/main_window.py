"""Minimal main window for the M0 desktop shell."""

from PySide6.QtWidgets import QMainWindow


class MainWindow(QMainWindow):
    """Empty application shell; domain editing starts in later milestones."""

    def __init__(self) -> None:
        super().__init__()
        self.setWindowTitle("Animated Fabric")
