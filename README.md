# node-red-contrib-python-venv

Node for python virtual environment

## Overview

With this node, you can run Python programs.  

When you install this node, python virtual environment (pyenv folder) is also created.  
You can run python.exe or pip.exe in that environment.

## Test Case

Windows 10

- Node.js: v20.10.0
- npm: 9.1.3
- Python: 3.8.3
- pip: 24.0

Raspberry Pi

- Debian bookworm
- Node.js: v18.19.0
- npm: 9.2.0
- Python: 3.11.2
- pip: 24.0

Sample flows are in the examples folder.  
![sample-flow.jpg](./img/sample-flow.jpg)

## Nodes

### venv node

python.exe is in the ./pyenv/Scripts/python.exe  

Write your Python code in the node.  
The program is saved in a tmp folder and executed.  
You can access Node-RED messages like `print(msg['payload'])`

![venv-node.jpg](./img/venv-node.png)

### pip node

pip.exe is in the ./pyenv/Scripts/pip.exe  

You can run pip commands like install, uninstall, list, etc.  
Select the options.  

![pip-node.jpg](./img/pip-node.png)

This node uses pip in the virtual environment, so it is different from the existing Python environment packages.  
Please compare.  

![pip-list.jpg](./img/pip-list.jpg)
