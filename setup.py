import subprocess
import os
import json
import shutil
import sys
from pathlib import Path

if len(sys.argv) < 2 or sys.argv[1].strip() == '':
    print('Usage: python setup.py <venv name or absolute path> [python version]', file=sys.stderr)
    sys.exit(2)

venvName = sys.argv[1]
version = sys.argv[2] if len(sys.argv) > 2 and sys.argv[2].strip() != '' else None

absDir = os.path.dirname(os.path.abspath(__file__))

if Path(venvName).is_absolute():
    venvPath = os.path.abspath(venvName)
else:
    venvPath = os.path.join(absDir, venvName)

if os.path.isdir(venvPath):
    # A virtual environment is used as it is, whoever created it. Nothing is
    # written into one created outside of Node-RED; the nodes find its
    # interpreter from the standard venv layout.
    if os.path.isfile(os.path.join(venvPath, 'pyvenv.cfg')) or os.path.isfile(os.path.join(venvPath, 'path.json')):
        print(f'{venvName} already exists.')
        sys.exit()

    print(f'ERROR: {venvName} exists but is not a Python virtual environment (pyvenv.cfg not found).', file=sys.stderr)
    sys.exit(1)

def markCreated():
    # Marks the venv as created by this node, which is what allows it to be
    # removed when its configuration node is deleted. Written right after the
    # venv exists so an interrupted setup is still cleaned up.
    with open(os.path.join(venvPath, '.node-red-venv-created'), 'w') as f:
        f.write('')

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

# On POSIX there is no launcher like py.exe, so a requested version maps to the
# versioned interpreter name. Fall back with a warning when it is not installed.
if os.name != 'nt' and version is not None:
    versionedCmd = f'python{version}'
    if shutil.which(versionedCmd):
        python_cmd = versionedCmd
    else:
        print(f'WARNING: {versionedCmd} was not found. Using {python_cmd} instead.', file=sys.stderr)

if os.name == 'nt':
    if version is not None:
        result = subprocess.run(['py', f'-{version}', '-m', 'venv', venvPath])
    else:
        result = subprocess.run([python_cmd, '-m', 'venv', venvPath])
    if result.returncode != 0:
        print('ERROR: Failed to create virtual environment.', file=sys.stderr)
        sys.exit(1)
    markCreated()
    # Try to upgrade pip, but don't fail if pip isn't available
    pip_result = subprocess.run([os.path.join(venvPath, 'Scripts', 'python.exe'), '-m', 'pip', 'install', '--upgrade', 'pip'])
    if pip_result.returncode != 0:
        print('WARNING: Failed to upgrade pip. pip may not be available in the virtual environment.', file=sys.stderr)
    path = {
        'NODE_PYENV_PYTHON': 'Scripts/python.exe',
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
    markCreated()
    # Try to upgrade pip, but don't fail if pip isn't available
    pip_result = subprocess.run([os.path.join(venvPath, 'bin', 'python'), '-m', 'pip', 'install', '--upgrade', 'pip'])
    if pip_result.returncode != 0:
        print('WARNING: Failed to upgrade pip in virtual environment.', file=sys.stderr)
    path = {
        'NODE_PYENV_PYTHON': 'bin/python',
        'NODE_PYENV_EXEC': 'bin/'
    }

with open(os.path.join(venvPath, 'path.json'), 'w') as f:
    json.dump(path, f, indent=4)
