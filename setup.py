import subprocess
import os
import json
import sys
from pathlib import Path

venvName = sys.argv[1]

absDir = os.path.dirname(os.path.abspath(__file__))

if Path(venvName).is_absolute():
    venvPath = venvName
else:
    venvPath = f'{absDir}/{venvName}'

if os.path.isdir(venvPath):
    print(f'{venvName} already exists.')
    sys.exit()

print("Creating Python virtual environment...")
if os.name == 'nt':
    if len(sys.argv) == 3:
        version = sys.argv[2]
        subprocess.run(['py', f'-{version}', '-m', 'venv', venvPath])
    else:
        subprocess.run(['python', '-m', 'venv', venvPath])
    subprocess.run([f'{venvPath}/Scripts/python.exe', '-m', 'pip', 'install', '--upgrade', 'pip'])
    path = {
        'NODE_PYENV_PYTHON': f'{venvPath}/Scripts/python.exe',
        'NODE_PYENV_PIP': f'{venvPath}/Scripts/pip.exe',
        'NODE_PYENV_EXEC': f'{venvPath}/Scripts/'
    }
else:
    subprocess.run(['python', '-m', 'venv', venvPath])
    subprocess.run([f'{venvPath}/bin/python', '-m', 'pip', 'install', '--upgrade', 'pip'])
    path = {
        'NODE_PYENV_PYTHON': f'{venvPath}/bin/python',
        'NODE_PYENV_PIP': f'{venvPath}/bin/pip',
        'NODE_PYENV_EXEC': f'{venvPath}/bin/'
    }

with open(f'{venvPath}/path.json', 'w') as f:
    json.dump(path, f, indent=4)
