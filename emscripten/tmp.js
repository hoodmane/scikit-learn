const { loadPyodide } = require('pyodide');

async function main() {
    let pyodide = await loadPyodide();
    console.log(pyodide.runPython("1+1"));
}
  
main();
  