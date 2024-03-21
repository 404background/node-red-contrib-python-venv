import subprocess
import os
import json

absDir = os.path.dirname(os.path.abspath(__file__))
subprocess.run(['python', '-m', 'venv', 'pyenv'])

if os.name == 'nt':
    subprocess.run([f'{absDir}/pyenv/Scripts/python.exe', '-m', 'pip', 'install', '--upgrade', 'pip'])
    path = {
        'NODE_PYENV_PYTHON': f'{absDir}/pyenv/Scripts/python.exe',
        'NODE_PYENV_PIP': f'{absDir}/pyenv/Scripts/pip.exe'
    }
else:
    subprocess.run([f'{absDir}/pyenv/bin/python', '-m', 'pip', 'install', '--upgrade', 'pip'])
    path = {
        'NODE_PYENV_PYTHON': f'{absDir}/pyenv/bin/python',
        'NODE_PYENV_PIP': f'{absDir}/pyenv/bin/pip'
    }

with open(f'{absDir}/path.json', 'w') as f:
    json.dump(path, f, indent=2)
