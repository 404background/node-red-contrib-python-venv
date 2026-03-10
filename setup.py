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

# Check if venv module is available
try:
    import venv
except ImportError:
    if os.name == 'nt':
        print('WARNING: Python venv module is not available.', file=sys.stderr)
        print('Please install Python from https://www.python.org/ (not the Microsoft Store version).', file=sys.stderr)
    else:
        print('WARNING: python3-venv is not installed.', file=sys.stderr)
        print('On Debian/Ubuntu, install it with: sudo apt install python3-venv', file=sys.stderr)
    sys.exit(1)

# Check if ensurepip (used by venv to bootstrap pip) is available
pip_available = True
try:
    import ensurepip
except ImportError:
    pip_available = False
    print('WARNING: ensurepip is not available. pip may not be installed in the virtual environment.', file=sys.stderr)
    if os.name == 'nt':
        print('Please install Python from https://www.python.org/ and ensure pip is included.', file=sys.stderr)
    else:
        print('On Debian/Ubuntu, install it with: sudo apt install python3-pip python3-venv', file=sys.stderr)

# Determine python command for subprocess calls
python_cmd = 'python' if os.name == 'nt' else 'python3'

if os.name == 'nt':
    if len(sys.argv) == 3:
        version = sys.argv[2]
        result = subprocess.run(['py', f'-{version}', '-m', 'venv', venvPath])
    else:
        result = subprocess.run([python_cmd, '-m', 'venv', venvPath])
    if result.returncode != 0:
        print('ERROR: Failed to create virtual environment.', file=sys.stderr)
        sys.exit(1)
    # Try to upgrade pip, but don't fail if pip isn't available
    pip_result = subprocess.run([f'{venvPath}/Scripts/python.exe', '-m', 'pip', 'install', '--upgrade', 'pip'])
    if pip_result.returncode != 0:
        print('WARNING: Failed to upgrade pip. pip may not be available in the virtual environment.', file=sys.stderr)
    path = {
        'NODE_PYENV_PYTHON': 'Scripts/python.exe',
        'NODE_PYENV_PIP': 'Scripts/pip.exe',
        'NODE_PYENV_EXEC': 'Scripts/'
    }
else:
    # Create venv; if ensurepip is missing, use --without-pip to avoid failure
    if pip_available:
        result = subprocess.run([python_cmd, '-m', 'venv', venvPath])
    else:
        result = subprocess.run([python_cmd, '-m', 'venv', '--without-pip', venvPath])
    if result.returncode != 0:
        print('ERROR: Failed to create virtual environment.', file=sys.stderr)
        sys.exit(1)
    # Try to upgrade pip, but don't fail if pip isn't available
    pip_result = subprocess.run([f'{venvPath}/bin/python', '-m', 'pip', 'install', '--upgrade', 'pip'])
    if pip_result.returncode != 0:
        print('WARNING: Failed to upgrade pip in virtual environment.', file=sys.stderr)
    path = {
        'NODE_PYENV_PYTHON': 'bin/python',
        'NODE_PYENV_PIP': 'bin/pip',
        'NODE_PYENV_EXEC': 'bin/'
    }

with open(f'{venvPath}/path.json', 'w') as f:
    json.dump(path, f, indent=4)
