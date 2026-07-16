"""Tests for the minimal M0 PySide6 shell."""

import os

os.environ.setdefault("QT_QPA_PLATFORM", "offscreen")

from PySide6.QtWidgets import QApplication  # noqa: E402

import animated_fabric.gui.app as gui_module  # noqa: E402
from animated_fabric.gui.app import create_application  # noqa: E402
from animated_fabric.gui.main_window import MainWindow  # noqa: E402


def test_application_factory_reuses_the_process_application() -> None:
    first = create_application([])
    second = create_application([])

    assert second is first


def test_main_window_has_the_english_product_title() -> None:
    application = create_application([])
    window = MainWindow()

    assert isinstance(application, QApplication)
    assert window.windowTitle() == "Animated Fabric"

    window.close()


def test_gui_entry_point_shows_the_window_and_returns_event_loop_code(
    monkeypatch,
) -> None:
    calls: list[str] = []

    class FakeApplication:
        def exec(self) -> int:
            calls.append("exec")
            return 7

    class FakeWindow:
        def show(self) -> None:
            calls.append("show")

    monkeypatch.setattr(gui_module, "create_application", FakeApplication)
    monkeypatch.setattr(gui_module, "MainWindow", FakeWindow)

    assert gui_module.main() == 7
    assert calls == ["show", "exec"]
