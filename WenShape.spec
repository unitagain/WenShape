# -*- mode: python ; coding: utf-8 -*-
from PyInstaller.utils.hooks import collect_data_files

datas = [('F:\\Github-WenShape-develop\\backend\\static', 'static'), ('F:\\Github-WenShape-develop\\backend\\config.yaml', '.')]
datas += collect_data_files('tiktoken_ext.openai_public')
datas += collect_data_files('tiktoken_ext')


a = Analysis(
    ['F:\\Github-WenShape-develop\\backend\\app\\main.py'],
    pathex=['F:\\Github-WenShape-develop\\backend'],
    binaries=[],
    datas=datas,
    hiddenimports=['uvicorn.logging', 'uvicorn.loops', 'uvicorn.loops.auto', 'uvicorn.protocols', 'uvicorn.protocols.http', 'uvicorn.protocols.http.auto', 'uvicorn.lifespan', 'uvicorn.lifespan.on', 'tiktoken', 'tiktoken_ext.openai_public', 'tiktoken_ext', 'aiohttp'],
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[],
    noarchive=False,
    optimize=0,
)
pyz = PYZ(a.pure)

exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name='WenShape',
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    console=True,
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
)
coll = COLLECT(
    exe,
    a.binaries,
    a.datas,
    strip=False,
    upx=True,
    upx_exclude=[],
    name='WenShape',
)
