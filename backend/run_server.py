"""Start the analyser web server on http://127.0.0.1:8000.

Run from the backend folder:  python run_server.py
API docs: http://127.0.0.1:8000/docs . If frontend/dist exists, the website is at /.
"""
import os
import sys
from pathlib import Path

import uvicorn

BACKEND_DIR = Path(__file__).resolve().parent

if __name__ == "__main__":
    os.chdir(BACKEND_DIR)                      # so 'analyser' imports from anywhere
    sys.path.insert(0, str(BACKEND_DIR))
    reload = "--reload" in sys.argv
    uvicorn.run("analyser.api.app:app", host="127.0.0.1", port=8000, reload=reload)
