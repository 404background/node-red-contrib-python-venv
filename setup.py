import subprocess
import os
import json
import sys

venvName = sys.argv[1]

absDir = os.path.dirname(os.path.abspath(__file__))

if os.path.isdir(f'{absDir}/{venvName}'):
    print(f'{venvName} already exists.')
    sys.exit()

if os.name == 'nt':
    if len(sys.argv) == 3:
        version = sys.argv[2]
        subprocess.run(['py', f'-{version}', '-m', 'venv', f'{absDir}/{venvName}'])
    else:
        subprocess.run(['python', '-m', 'venv', f'{absDir}/{venvName}'])
    subprocess.run([f'{absDir}/{venvName}/Scripts/python.exe', '-m', 'pip', 'install', '--upgrade', 'pip'])
    path = {
        'NODE_PYENV_PYTHON': f'{absDir}/{venvName}/Scripts/python.exe',
        'NODE_PYENV_PIP': f'{absDir}/{venvName}/Scripts/pip.exe'
    }
else:
    subprocess.run(['python', '-m', 'venv', f'{absDir}/{venvName}'])
    subprocess.run([f'{absDir}/{venvName}/bin/python', '-m', 'pip', 'install', '--upgrade', 'pip'])
    path = {
        'NODE_PYENV_PYTHON': f'{absDir}/{venvName}/bin/python',
        'NODE_PYENV_PIP': f'{absDir}/{venvName}/bin/pip'
    }

with open(f'{absDir}/{venvName}/path.json', 'w') as f:
    json.dump(path, f, indent=4)
