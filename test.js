var easyBenchMark = require('./index');

easyBenchMark.init();
var duration = easyBenchMark.runTest();

var div = document.createElement('div')
div.innerText = 'GPU Benchmark Test: ' + duration + 'ms';
document.body.appendChild(div)