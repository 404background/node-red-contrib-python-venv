import subprocess
import os

absDir = os.path.dirname(os.path.abspath(__file__))
subprocess.run('python -m venv pyenv')
subprocess.run(f'{absDir}/pyenv/Scripts/python.exe -m pip install --upgrade pip')
