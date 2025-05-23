# node-red-contrib-python-venv

Node to use Python virtual environment in Node-RED

[![GitHub Sponsor](https://img.shields.io/static/v1?label=Sponsor&message=%E2%9D%A4&logo=GitHub&color=ff69b4)](https://github.com/sponsors/404background)
[![npm version](https://img.shields.io/npm/v/@background404/node-red-contrib-python-venv?style=flat-square)](https://www.npmjs.com/package/@background404/node-red-contrib-python-venv)
[![npm downloads](https://img.shields.io/npm/dm/@background404/node-red-contrib-python-venv?style=flat-square)](https://www.npmjs.com/package/@background404/node-red-contrib-python-venv)
[![GitHub Discussions](https://img.shields.io/github/discussions/404background/node-red-contrib-python-venv?color=blue&label=Discussions&logo=github)](https://github.com/404background/node-red-contrib-python-venv/discussions)

If you would like to find a sample flow or have questions, please visit [GitHub Discussions](https://github.com/404background/node-red-contrib-python-venv/discussions) page!

## Overview

With this node, you can run Python in Python's virtual environments in Node-RED.

When you install this node, python virtual environment (pyenv folder) is also created.  
You can run python(.exe) or pip(.exe) in that environment.

Sample flows are in the examples folder.  
![sample-flow.png](./img/sample-flow.png)

## Nodes

### venv node

python(.exe) is in the ./pyenv/Scripts/python.exe or Python virtual environment you have added.

Write your Python code in the node.  
The program is saved in the virtual environment and executed.

![venv-node.jpg](./img/venv-node.png)

You can access Node-RED messages like `print(msg['payload'])`.

![msg-property.png](./img/msg-property.png)

You can also access flow and global objects like `print(node['flow']['payload'])`, `print(node['global']['payload'])`.

![msg-property-flow-global.png](./img/msg-property-flow-global.png)

The number of running nodes is displayed in the status.

![running-status.png](./img/running-status.png)

The venv node stops execution when `msg.kill` or `msg.terminate` is set to `true`, aligning its behavior with Node-RED's `exec` node.

### pip node

pip(.exe) is in the ./pyenv/Scripts/pip.exe or Python virtual environment you have added.

You can run pip commands like install, uninstall, list.  
Select the commands.

![pip-node.jpg](./img/pip-node.png)

This node uses pip in the virtual environment, so it is different from the existing Python environment packages.  
Please compare.

![pip-list.jpg](./img/pip-list.jpg)

### venv-exec

This node can execute executable files in Scripts or bin folder.

![venv-exec.jpg](./img/venv-exec.jpg)

You can see the name of the executable in List Executables mode.  
Then you can execute it with arguments in Execute mode.

![venv-exec-list.jpg](./img/venv-exec-list.jpg)
![venv-exec-execute.jpg](./img/venv-exec-execute.jpg)

The venv-exec node stops execution when either `msg.kill` or `msg.terminate` is set to `true`, aligning its behavior with Node-RED's `exec` node.

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

My article: Creating Nodes for Node-RED Part 1 (python-venv)  
<https://404background.com/en/programming/creating-nodes-1/>

My article: python-venv node development history (2024)  
<https://qiita.com/background/items/3244fc1b70cc454befef>  

### Nodes created based on this node

voicevox-core node: Node that outputs Japanese audio files using voicevox-core  
<https://flows.nodered.org/node/@background404/node-red-contrib-voicevox-core>

whisper node: Node to transcribe text using Open AI's Whisper  
<https://flows.nodered.org/node/@background404/node-red-contrib-whisper>
