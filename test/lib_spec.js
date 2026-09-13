const assert = require('assert')
const os = require('os')
const fs = require('fs')
const path = require('path')

const venvPaths = require('../node/lib/venv-paths')
const bridge = require('../node/lib/python-bridge')
const commandArgs = require('../node/lib/command-args')
const runtime = require('../node/lib/node-runtime')

describe('venv-paths', function () {
  it('resolves a relative name against the package root', function () {
    assert.strictEqual(
      venvPaths.resolveVenvDir('pyenv'),
      path.join(venvPaths.PACKAGE_ROOT, 'pyenv')
    )
  })

  it('keeps an absolute name as is', function () {
    const absolute = path.resolve(os.tmpdir(), 'some-venv')
    assert.strictEqual(venvPaths.resolveVenvDir(absolute), absolute)
  })

  it('rejects a missing or blank name', function () {
    assert.throws(() => venvPaths.resolveVenvDir(undefined), /not configured/)
    assert.throws(() => venvPaths.resolveVenvDir('   '), /not configured/)
  })

  it('reports a virtual environment without path.json', function () {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'venv-paths-'))
    try {
      assert.throws(() => venvPaths.readVenvPaths(dir), /path\.json not found/)
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })

  it('falls back to the default layout when path.json entries are stale', function () {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'venv-paths-'))
    try {
      fs.writeFileSync(
        path.join(dir, 'path.json'),
        JSON.stringify({ NODE_PYENV_PYTHON: 'gone/python' })
      )
      const resolved = venvPaths.readVenvPaths(dir)
      assert.strictEqual(
        resolved.python,
        path.normalize(path.join(dir, venvPaths.DEFAULT_RELATIVE_PATHS.python))
      )
      assert.strictEqual(resolved.venvDir, dir)
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })

  it('reports unreadable path.json instead of throwing a parse error', function () {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'venv-paths-'))
    try {
      fs.writeFileSync(path.join(dir, 'path.json'), '{ not json')
      assert.throws(() => venvPaths.readVenvPaths(dir), /Failed to read/)
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe('python-bridge', function () {
  describe('sanitizeBaseName', function () {
    it('replaces characters that are illegal in file names', function () {
      assert.strictEqual(bridge.sanitizeBaseName('a/b:c*d?e'), 'a_b_c_d_e')
    })

    it('keeps spaces, which existing script files rely on', function () {
      assert.strictEqual(bridge.sanitizeBaseName('hello world'), 'hello world')
    })

    it('drops trailing dots and spaces that Windows rejects', function () {
      assert.strictEqual(bridge.sanitizeBaseName('report...'), 'report')
      assert.strictEqual(bridge.sanitizeBaseName('report   '), 'report')
    })

    it('caps the length', function () {
      assert.strictEqual(bridge.sanitizeBaseName('x'.repeat(200)).length, 64)
    })

    it('returns an empty string when nothing usable remains', function () {
      assert.strictEqual(bridge.sanitizeBaseName('   '), '')
    })
  })

  describe('context detection', function () {
    it('detects both quote styles', function () {
      assert.ok(bridge.usesFlowContext("node['flow']['a'] = 1"))
      assert.ok(bridge.usesFlowContext('node["flow"]["a"] = 1'))
      assert.ok(bridge.usesGlobalContext("node['global']['a'] = 1"))
    })

    it('does not fire on unrelated code', function () {
      assert.ok(!bridge.usesFlowContext("print('flow')"))
      assert.ok(!bridge.usesGlobalContext('x = 1'))
    })
  })

  it('stringifies objects containing circular references', function () {
    const obj = { payload: 1 }
    obj.self = obj
    const json = JSON.parse(bridge.stringifyWithoutCircularReferences(obj))
    assert.strictEqual(json.payload, 1)
    assert.strictEqual(json.self, undefined)
  })

  describe('context read/write', function () {
    function makeStore(initial) {
      const store = new Map(Object.entries(initial || {}))
      return {
        keys: () => [...store.keys()],
        get: k => store.get(k),
        set: (k, v) => store.set(k, v),
        dump: () => Object.fromEntries(store),
      }
    }

    it('snapshots every key', function () {
      const store = makeStore({ a: 1, b: { c: 2 } })
      assert.deepStrictEqual(bridge.readContext(store), { a: 1, b: { c: 2 } })
    })

    it('only writes back keys whose value changed', function () {
      const written = []
      const store = {
        set: (k, v) => written.push([k, v]),
      }
      bridge.writeChangedContext(
        store,
        { unchanged: 1, changed: 3, added: 9 },
        { unchanged: 1, changed: 2 }
      )
      assert.deepStrictEqual(written, [
        ['changed', 3],
        ['added', 9],
      ])
    })
  })

  describe('buildBootstrapScript', function () {
    it('always loads msg and defines the node dict', function () {
      const script = bridge.buildBootstrapScript(false, false)
      assert.ok(script.includes("_nr_io['msg']"))
      assert.ok(script.includes("node = {'flow': {}, 'global': {}}"))
      assert.ok(script.includes("_nr_write_back('msgOut', msg)"))
    })

    it('omits context handling that the script does not need', function () {
      const script = bridge.buildBootstrapScript(false, false)
      assert.ok(!script.includes('flowOut'))
      assert.ok(!script.includes('globalOut'))
    })

    it('adds context handling on demand', function () {
      const script = bridge.buildBootstrapScript(true, true)
      assert.ok(script.includes("_nr_write_back('flowOut', node['flow'])"))
      assert.ok(script.includes("_nr_write_back('globalOut', node['global'])"))
    })

    it('never embeds a file path in the generated source', function () {
      const script = bridge.buildBootstrapScript(true, true)
      assert.ok(script.includes("_nr_os.environ['NODE_RED_VENV_IO']"))
      assert.ok(!/[A-Za-z]:\\/.test(script))
    })

    it('compiles the user script under its real file name', function () {
      const script = bridge.buildBootstrapScript(false, false)
      assert.ok(
        script.includes("compile(_nr_source, _nr_io['script'], 'exec')")
      )
    })
  })
})

describe('command-args', function () {
  describe('parseArguments', function () {
    it('splits on whitespace', function () {
      assert.deepStrictEqual(commandArgs.parseArguments('-m pip list'), [
        '-m',
        'pip',
        'list',
      ])
    })

    it('keeps quoted values together and strips the quotes', function () {
      assert.deepStrictEqual(commandArgs.parseArguments('-c "print(1 + 1)"'), [
        '-c',
        'print(1 + 1)',
      ])
      assert.deepStrictEqual(commandArgs.parseArguments("run 'a b'"), [
        'run',
        'a b',
      ])
    })

    it('keeps a quoted section attached to its option', function () {
      assert.deepStrictEqual(commandArgs.parseArguments('--path="a b"'), [
        '--path=a b',
      ])
    })

    it('preserves an intentionally empty argument', function () {
      assert.deepStrictEqual(commandArgs.parseArguments('-c ""'), ['-c', ''])
    })

    it('returns nothing for blank input', function () {
      assert.deepStrictEqual(commandArgs.parseArguments('   '), [])
    })
  })

  describe('splitPackageNames', function () {
    it('drops the empty parts that repeated spaces produce', function () {
      assert.deepStrictEqual(
        commandArgs.splitPackageNames('  requests   numpy '),
        ['requests', 'numpy']
      )
    })

    it('returns nothing for a blank argument', function () {
      assert.deepStrictEqual(commandArgs.splitPackageNames(''), [])
      assert.deepStrictEqual(commandArgs.splitPackageNames('   '), [])
    })
  })

  describe('resolveExecutable', function () {
    const base = path.resolve(os.tmpdir(), 'venv', 'Scripts')

    it('resolves a plain file name inside the directory', function () {
      assert.strictEqual(
        commandArgs.resolveExecutable(base, 'pip.exe'),
        path.join(base, 'pip.exe')
      )
    })

    it('refuses to escape the directory', function () {
      assert.throws(
        () => commandArgs.resolveExecutable(base, '../../evil'),
        /must be located inside/
      )
    })

    it('refuses an absolute path outside the directory', function () {
      assert.throws(
        () =>
          commandArgs.resolveExecutable(base, path.resolve(os.tmpdir(), 'x')),
        /must be located inside/
      )
    })

    it('refuses the directory itself', function () {
      assert.throws(
        () => commandArgs.resolveExecutable(base, '.'),
        /must be located inside/
      )
    })
  })
})

describe('node-runtime', function () {
  function fakeNode(overrides) {
    const node = {
      statuses: [],
      errors: [],
      sent: [],
      closeHandler: null,
      status(value) {
        node.statuses.push(value)
      },
      error(err, msg) {
        node.errors.push([err, msg])
      },
      send(msg) {
        node.sent.push(msg)
      },
      on(event, handler) {
        if (event === 'close') {
          node.closeHandler = handler
        }
      },
    }
    return Object.assign(node, overrides)
  }

  function fakeChild() {
    return {
      killed: false,
      kill() {
        this.killed = true
      },
    }
  }

  const fakeRED = {
    util: {
      cloneMessage: msg => JSON.parse(JSON.stringify(msg)),
    },
  }

  describe('statusReporter', function () {
    it('prefixes translated keys with the node namespace', function () {
      const node = fakeNode()
      runtime.statusReporter(node, 'venv').key('red', 'error')
      assert.deepStrictEqual(node.statuses[0], {
        fill: 'red',
        shape: 'dot',
        text: 'venv.error',
      })
    })

    it('passes literal texts through unchanged', function () {
      const node = fakeNode()
      runtime.statusReporter(node, 'venv').text('blue', 'Running: 2')
      assert.strictEqual(node.statuses[0].text, 'Running: 2')
    })

    it('clears the status', function () {
      const node = fakeNode()
      runtime.statusReporter(node, 'pip').clear()
      assert.deepStrictEqual(node.statuses[0], {})
    })
  })

  describe('resolveVenvForNode', function () {
    it('reports a missing configuration node instead of throwing', function () {
      const node = fakeNode()
      const status = runtime.statusReporter(node, 'venv')
      const RED = { nodes: { getNode: () => null } }
      const paths = runtime.resolveVenvForNode(RED, node, {}, status)
      assert.strictEqual(paths, null)
      assert.strictEqual(node.statuses[0].text, 'venv.error')
      assert.match(node.errors[0][0], /Missing virtual environment/)
    })

    it('reports an environment that is not ready', function () {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'venv-runtime-'))
      try {
        const node = fakeNode()
        const status = runtime.statusReporter(node, 'venv')
        const RED = { nodes: { getNode: () => ({ venvname: dir }) } }
        const paths = runtime.resolveVenvForNode(RED, node, {}, status)
        assert.strictEqual(paths, null)
        assert.match(node.errors[0][0], /path\.json not found/)
      } finally {
        fs.rmSync(dir, { recursive: true, force: true })
      }
    })

    it('returns the resolved paths of a ready environment', function () {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'venv-runtime-'))
      try {
        fs.writeFileSync(path.join(dir, 'path.json'), '{}')
        const node = fakeNode()
        const status = runtime.statusReporter(node, 'venv')
        const RED = { nodes: { getNode: () => ({ venvname: dir }) } }
        const paths = runtime.resolveVenvForNode(RED, node, {}, status)
        assert.strictEqual(paths.venvDir, dir)
        assert.strictEqual(node.errors.length, 0)
      } finally {
        fs.rmSync(dir, { recursive: true, force: true })
      }
    })
  })

  describe('legacy callbacks', function () {
    it('keeps the callbacks Node-RED 1.x provides', function () {
      const node = fakeNode()
      const send = () => {}
      const done = () => {}
      assert.strictEqual(runtime.legacySend(node, send), send)
      assert.strictEqual(runtime.legacyDone(node, {}, done), done)
    })

    it('falls back to node.send and node.error', function () {
      const node = fakeNode()
      runtime.legacySend(node, undefined)({ payload: 1 })
      assert.deepStrictEqual(node.sent, [{ payload: 1 }])

      const msg = { payload: 1 }
      runtime.legacyDone(node, msg, undefined)('boom')
      assert.deepStrictEqual(node.errors, [['boom', msg]])
    })

    it('stays quiet when the fallback is called without an error', function () {
      const node = fakeNode()
      runtime.legacyDone(node, {}, undefined)()
      assert.strictEqual(node.errors.length, 0)
    })
  })

  describe('callOnce', function () {
    it('lets only the first call through', function () {
      let calls = 0
      const guarded = runtime.callOnce(() => ++calls)
      assert.strictEqual(guarded(), 1)
      assert.strictEqual(guarded(), undefined)
      assert.strictEqual(calls, 1)
    })
  })

  describe('messageDeriver', function () {
    it('clones the message so outputs stay independent', function () {
      const msg = { payload: 'in', nested: { value: 1 } }
      const derive = runtime.messageDeriver(fakeRED, msg)
      const copy = derive('out')
      copy.nested.value = 2
      assert.strictEqual(copy.payload, 'out')
      assert.strictEqual(msg.payload, 'in')
      assert.strictEqual(msg.nested.value, 1)
    })
  })

  describe('describeExit', function () {
    it('reports the exit code on its own', function () {
      assert.deepStrictEqual(runtime.describeExit(0, null), { code: 0 })
    })

    it('adds the signal when the process was killed', function () {
      assert.deepStrictEqual(runtime.describeExit(null, 'SIGTERM'), {
        code: null,
        signal: 'SIGTERM',
      })
    })
  })

  describe('pickArgument', function () {
    it('prefers the configured value', function () {
      assert.strictEqual(runtime.pickArgument('requests', 'numpy'), 'requests')
    })

    it('falls back to the payload', function () {
      assert.strictEqual(runtime.pickArgument('', 'numpy'), 'numpy')
      assert.strictEqual(runtime.pickArgument(undefined, 42), '42')
    })

    it('returns an empty string when neither carries a value', function () {
      assert.strictEqual(runtime.pickArgument('', undefined), '')
      assert.strictEqual(runtime.pickArgument(undefined, ''), '')
    })
  })

  describe('trackChildProcesses', function () {
    it('kills the tracked processes when the node is closed', function () {
      const node = fakeNode()
      const active = runtime.trackChildProcesses(node)
      const first = fakeChild()
      const second = fakeChild()
      active.add(first)
      active.add(second)

      let closed = false
      node.closeHandler(true, () => {
        closed = true
      })

      assert.strictEqual(first.killed, true)
      assert.strictEqual(second.killed, true)
      assert.strictEqual(active.size, 0)
      assert.strictEqual(closed, true)
    })

    it('runs the marker callback before killing', function () {
      const node = fakeNode()
      const seen = []
      const active = runtime.trackChildProcesses(node, child => {
        seen.push(child.killed)
      })
      active.add(fakeChild())
      node.closeHandler(true, () => {})
      assert.deepStrictEqual(seen, [false])
    })
  })

  describe('killAll', function () {
    it('empties the set it is given', function () {
      const active = new Set([fakeChild(), fakeChild()])
      runtime.killAll(active)
      assert.strictEqual(active.size, 0)
    })
  })
})
