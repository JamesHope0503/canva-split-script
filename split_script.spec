# -*- mode: python ; coding: utf-8 -*-
from pathlib import Path

from PyInstaller.utils.hooks import collect_all

ROOT = Path(SPECPATH)

datas = [
    (str(ROOT / "index.html"), "."),
    (str(ROOT / "styles.css"), "."),
    (str(ROOT / "app.js"), "."),
    (str(ROOT / "vendor"), "vendor"),
]
binaries = []
hiddenimports = [
    "clr",
    "clr_loader",
    "pythonnet",
    "webview",
    "webview.platforms.winforms",
    "webview.platforms.edgechromium",
]

for pkg in ("webview", "pythonnet", "clr_loader"):
    collected_datas, collected_binaries, collected_hidden = collect_all(pkg)
    datas += collected_datas
    binaries += collected_binaries
    hiddenimports += collected_hidden

a = Analysis(
    [str(ROOT / "app.py")],
    pathex=[str(ROOT)],
    binaries=binaries,
    datas=datas,
    hiddenimports=hiddenimports,
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[],
    noarchive=False,
)
pyz = PYZ(a.pure)
exe = EXE(
    pyz,
    a.scripts,
    a.binaries,
    a.datas,
    [],
    name="SplitCanva",
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=False,
    console=False,
    disable_windowed_traceback=False,
)
