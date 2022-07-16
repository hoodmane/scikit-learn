const { opendir } = require('node:fs/promises');
const { loadPyodide } = require('pyodide');

async function findWheel(distDir) {
  const dir = await opendir(distDir);
  for await (const dirent of dir) {
    if (dirent.name.endsWith('wasm32.whl')) {
      return dirent.name;
    }
  }
}

const pkgDir = process.argv[2];
const distDir = pkgDir + '/dist';

function make_tty_ops(stream){
  return {
    // get_char has 3 particular return values:
    // a.) the next character represented as an integer
    // b.) undefined to signal that no data is currently available
    // c.) null to signal an EOF
    get_char(tty) {
      if (!tty.input.length) {
        var result = null;
        var BUFSIZE = 256;
        var buf = Buffer.alloc(BUFSIZE);
        var bytesRead = fs.readSync(process.stdin.fd, buf, 0, BUFSIZE, -1);
        if (bytesRead === 0) {
          return null;
        }
        result = buf.slice(0, bytesRead);
        tty.input = Array.from(result);
      }
      return tty.input.shift();
    },
    put_char(tty, val) {
      try {
        if(val !== null){
          tty.output.push(val);
        }
        if (val === null || val === 10) {
          process.stdout.write(Buffer.from(tty.output));
          tty.output = [];
        }
      } catch(e){
        console.warn(e);
      }
    },
    flush(tty) {
      if (!tty.output || tty.output.length === 0) {
        return;
      }
      stream.write(Buffer.from(tty.output));
      tty.output = [];
    }
  };
}

function setupStreams(FS, TTY){
  let mytty = FS.makedev(FS.createDevice.major++, 0);
  let myttyerr = FS.makedev(FS.createDevice.major++, 0);
  TTY.register(mytty, make_tty_ops(process.stdout))
  TTY.register(myttyerr, make_tty_ops(process.stderr))
  FS.mkdev('/dev/mytty', mytty);
  FS.mkdev('/dev/myttyerr', myttyerr);
  FS.unlink('/dev/stdin');
  FS.unlink('/dev/stdout');
  FS.unlink('/dev/stderr');
  FS.symlink('/dev/mytty', '/dev/stdin');
  FS.symlink('/dev/mytty', '/dev/stdout');
  FS.symlink('/dev/myttyerr', '/dev/stderr');
  FS.closeStream(0);
  FS.closeStream(1);
  FS.closeStream(2);
  FS.open('/dev/stdin', 0);
  FS.open('/dev/stdout', 1);
  FS.open('/dev/stderr', 1);
}

async function main() {
  const wheelName = await findWheel(distDir);
  const wheelURL = `file:${distDir}/${wheelName}`;
  let exitcode = 0;
  try {
    pyodide = await loadPyodide();
    const FS = pyodide.FS;
    setupStreams(FS, pyodide._module.TTY);
    const NODEFS = FS.filesystems.NODEFS;
    FS.chdir("/lib/python3.10/site-packages/");
    
    await pyodide.loadPackage(['micropip']);
    await pyodide.runPythonAsync(`
      from pathlib import Path
      import micropip

      # reqs = [x for x in Path("./test_requirements.txt").read_text().split() if not x.startswith("#")]
      reqs = ["cython>=0.29.30,<3.0",
      "wheel==0.37.0",
      "setuptools==59.2.0",
      "hypothesis==6.24.1",
      "pytest==6.2.5",
      "pytz==2021.3",
      "typing_extensions>=4.2.0",]
      reqs.extend(["tomli", "${wheelURL}"])
      await micropip.install(reqs)
    `);
    const pytest = pyodide.pyimport('pytest');
    exitcode = pytest.main(pyodide.toPy([...process.argv.slice(3)]));
  } catch (e) {
    console.error(e);
    exitcode = 1;
  } finally {
    // worker.terminate();
    process.exit(exitcode);
  }
}

main();
