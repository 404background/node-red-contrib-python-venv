# node-red-contrib-python-venv

Node for python virtual environment

## Overview

With this node, you can run Python programs.

When you install this node, python virtual environment (pyenv folder) is also created.  
You can run python(.exe) or pip(.exe) in that environment.

## Test Case

Windows 10

- Node.js: v20.10.0
- npm: 9.1.3
- Python: 3.8.3
- pip: 24.0

Sample flows are in the examples folder.  
![sample-flow.png](./img/sample-flow.png)

## Nodes

### venv node

python(.exe) is in the ./pyenv/Scripts/python.exe or Python virtual environment you have added.

Write your Python code in the node.  
The program is saved in the virtual environment and executed.

![venv-node.jpg](./img/venv-node.png)

You can access Node-RED messages like `print(msg['payload'])`.

![msg-property-flow.png](./img/msg-property-flow.png)

![msg-property.png](./img/msg-property.png)

![msg-property-inject.png](./img/msg-property-inject.png)

The number of running nodes is displayed in the status.

![running-status.png](./img/running-status.png)

### pip node

pip(.exe) is in the ./pyenv/Scripts/pip.exe or Python virtual environment you have added.

You can run pip commands like install, uninstall, list.  
Select the commands.

![pip-node.jpg](./img/pip-node.png)

This node uses pip in the virtual environment, so it is different from the existing Python environment packages.  
Please compare.

![pip-list.jpg](./img/pip-list.jpg)

### venv-config (config node)

You can create and switch between multiple Python virtual environments.  
You need to add and set the name of the virtual environment.  
You can also specify the Python version **only in Windows**.  
![venv-config.png](./img/venv-config.png)

When a configuration node is deleted, the virtual environment with that name is also deleted.  
If you add a node with the same venv Name, only one virtual environment will be created.

The nodes can be executed by creating virtual environments even if the venv Name contains spaces or is an absolute path.  
![venv-config-abspath.png](./img/venv-config-abspath.png)

## Other Links

### Technical Articles

I refer to "Creating Nodes" page of Node-RED.  
<https://nodered.org/docs/creating-nodes/>

My article about python-venv (version 0.0.2)  
In Japanese: Node-REDのノードを作成してみる　その１（python-venv）  
<https://404background.com/program/node-create-python-venv/>  
In English: Creating Nodes for Node-RED Part 1 (python-venv)  
<https://404background.com/en/programming/creating-nodes-1/>

### Nodes created based on this node

voicevox-core node: Node that outputs Japanese audio files using voicevox-core  
<https://flows.nodered.org/node/@background404/node-red-contrib-voicevox-core>

whisper node: Node to transcribe text using Open AI's Whisper  
<https://flows.nodered.org/node/@background404/node-red-contrib-whisper>
