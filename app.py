import ctypes
import sys
import threading
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

import webview

APP_TITLE = "分割Canva文案"
APP_W = 1200
APP_H = 1000
ROOT = Path(__file__).resolve().parent
GWL_STYLE = -16
WS_THICKFRAME = 0x00040000
WS_MAXIMIZEBOX = 0x00010000
SWP_NOMOVE = 0x0002
SWP_NOZORDER = 0x0004
SWP_FRAMECHANGED = 0x0020


class RECT(ctypes.Structure):
    _fields_ = [
        ("left", ctypes.c_long),
        ("top", ctypes.c_long),
        ("right", ctypes.c_long),
        ("bottom", ctypes.c_long),
    ]


class QuietHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def log_message(self, format, *args):
        return


def start_static_server():
    server = ThreadingHTTPServer(("127.0.0.1", 0), QuietHandler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    return server.server_address[1]


def find_hwnd(win=None):
    native = getattr(win, "native", None) if win is not None else None
    handle = getattr(native, "Handle", None) if native is not None else None
    if handle is not None:
        try:
            return int(handle.ToInt64())
        except Exception:
            try:
                return int(handle)
            except Exception:
                pass
    return ctypes.windll.user32.FindWindowW(None, APP_TITLE)


def lock_fixed_window(win=None):
    try:
        user32 = ctypes.windll.user32
        hwnd = find_hwnd(win)
        if not hwnd:
            return False

        style = user32.GetWindowLongW(hwnd, GWL_STYLE)
        next_style = style & ~WS_THICKFRAME & ~WS_MAXIMIZEBOX
        if next_style != style:
            user32.SetWindowLongW(hwnd, GWL_STYLE, next_style)

        client = RECT()
        window = RECT()
        user32.GetClientRect(hwnd, ctypes.byref(client))
        user32.GetWindowRect(hwnd, ctypes.byref(window))
        extra_w = (window.right - window.left) - (client.right - client.left)
        extra_h = (window.bottom - window.top) - (client.bottom - client.top)
        user32.SetWindowPos(
            hwnd,
            0,
            0,
            0,
            APP_W + extra_w,
            APP_H + extra_h,
            SWP_NOMOVE | SWP_NOZORDER | SWP_FRAMECHANGED,
        )
        return True
    except Exception:
        return False


def hide_console():
    hwnd = ctypes.windll.kernel32.GetConsoleWindow()
    if hwnd:
        ctypes.windll.user32.ShowWindow(hwnd, 0)


def bring_to_front(hwnd):
    if not hwnd:
        return
    SW_RESTORE = 9
    ctypes.windll.user32.ShowWindow(hwnd, SW_RESTORE)
    ctypes.windll.user32.SetForegroundWindow(hwnd)


def show_error(message):
    ctypes.windll.user32.MessageBoxW(None, str(message), APP_TITLE, 0x10)


def default_save_dir():
    downloads = Path.home() / "Downloads"
    return str(downloads if downloads.is_dir() else Path.home())


def safe_filename(name):
    raw = Path(str(name or "export.csv")).name.strip() or "export.csv"
    cleaned = "".join("_" if ch in '<>:"/\\|?*' else ch for ch in raw).strip(" .")
    if not cleaned:
        cleaned = "export.csv"
    if not cleaned.lower().endswith(".csv"):
        cleaned += ".csv"
    return cleaned


class JsApi:
    def save_csv(self, filename, content):
        name = safe_filename(filename)
        text = "" if content is None else str(content)
        window = webview.windows[0] if webview.windows else None
        if window is None:
            return {"ok": False, "error": "window missing"}
        result = window.create_file_dialog(
            webview.SAVE_DIALOG,
            directory=default_save_dir(),
            save_filename=name,
            file_types=("CSV Files (*.csv)",),
        )
        if not result:
            return {"ok": False, "cancelled": True}
        path = result[0] if isinstance(result, (list, tuple)) else result
        Path(path).write_bytes(text.encode("utf-8"))
        return {"ok": True, "path": str(path)}


def main():
    existing = ctypes.windll.user32.FindWindowW(None, APP_TITLE)
    if existing:
        bring_to_front(existing)
        return

    index = ROOT / "index.html"
    if not index.exists():
        raise SystemExit(f"找不到页面：{index}")

    port = start_static_server()
    window = webview.create_window(
        APP_TITLE,
        url=f"http://127.0.0.1:{port}/index.html",
        js_api=JsApi(),
        width=APP_W,
        height=APP_H,
        resizable=False,
        maximized=False,
        fullscreen=False,
        easy_drag=False,
        text_select=True,
        min_size=(APP_W, APP_H),
        background_color="#E7EEF0",
    )

    def on_shown():
        try:
            hide_console()
            lock_fixed_window(window)
            bring_to_front(find_hwnd(window))
        except Exception:
            pass
        threading.Timer(0.25, lambda: lock_fixed_window(window) if window else None).start()

    window.events.shown += on_shown

    start_kwargs = {}
    if sys.platform == "win32":
        start_kwargs["gui"] = "edgechromium"
    webview.start(**start_kwargs)


if __name__ == "__main__":
    log_path = ROOT / "launch.log"
    try:
        main()
    except Exception:
        import traceback
        detail = traceback.format_exc()
        log_path.write_text(detail, encoding="utf-8")
        show_error(detail[-800:])
        raise

