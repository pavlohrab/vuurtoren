# PyInstaller spec of the desktop sidecar: `kenning_nlp` as a one-directory bundle.
# Built by build_sidecar.py (it trims the venv first, like the slim Docker image). Run from server/nlp/desktop.
# ruff: noqa
import sys

from PyInstaller.utils.hooks import collect_all, copy_metadata

datas, binaries, hiddenimports = [], [], []
# Packages that load data files, plugins (entry points) or compiled modules at runtime.
for pkg in (
    "kenning_nlp",
    "spacy",
    "spacy_legacy",
    "spacy_loggers",
    "thinc",
    "nl_core_news_md",
    "srsly",
    "catalogue",
    "confection",
    "ctranslate2",
    "sentencepiece",
    "wordfreq",
    "simplemma",
    "trafilatura",
    "justext",
    "courlan",
    "htmldate",
    "pypdfium2",
    "pypdfium2_raw",
    "uvicorn",
    "langcodes",
    "language_data",
    # OCR: RapidOCR loads its config (YAML) and bundled models (ONNX) from its package folder.
    "rapidocr",
    "onnxruntime",
    "cv2",
    "pyclipper",
    "shapely",
    "omegaconf",
):
    try:
        d, b, h = collect_all(pkg)
    except Exception as e:  # not installed on this platform
        print(f"skip {pkg}: {e}")
        continue
    datas += d
    binaries += b
    hiddenimports += h
# importlib.metadata versions (the analyzer version hashes them) and entry points.
for dist in ("spacy", "nl-core-news-md", "wordfreq", "simplemma", "thinc", "kenning-nlp"):
    datas += copy_metadata(dist)

a = Analysis(
    ["entry.py"],
    pathex=[],
    binaries=binaries,
    datas=datas,
    hiddenimports=hiddenimports,
    excludes=["tkinter", "matplotlib", "IPython", "pytest", "torch", "tensorflow"],
    # The analyzer version hashes the source of its modules: keep them as .py files.
    module_collection_mode={"kenning_nlp": "py"},
    noarchive=False,
)
pyz = PYZ(a.pure)
exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name="kenning-nlp",
    console=True,  # the app hides the window (CREATE_NO_WINDOW) and keeps stdin as a pipe
    strip=sys.platform != "win32",
    upx=False,
)
coll = COLLECT(exe, a.binaries, a.datas, strip=sys.platform != "win32", upx=False, name="kenning-nlp")
