var turbojs = require('./turbo');

var foo;
var mainStr = "void main(void) { commit(read() * 1.);  }"

function init(){
    foo = turbojs.alloc(1e6);
    for (var i = 0; i < 1e6; i++) foo.data[i] = i;
}

function run(){
    var startTime = +new Date;
    for(var ii = 0; ii < 10; ii++) turbojs.run(foo, mainStr);
    var endTime = +new Date;

    return endTime - startTime;
}


module.exports = {
    init : init,
    runTest : run
}