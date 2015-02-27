var Promise = require("bluebird")

// http://stackoverflow.com/questions/28459812/way-to-provide-this-to-the-global-scope#28459875
// http://stackoverflow.com/questions/27561158/timed-promise-queue-throttle

module.exports = promiseDebounce

function promiseDebounce(fn, delay, count) {
  var working = 0, queue = [];
  function work() {
    if ((queue.length === 0) || (working === count)) return;
    working++;
    Promise.delay(delay).tap(function () { working--; }).then(work);
    var next = queue.shift();
    next[2](fn.apply(next[0], next[1]));
  }
  return function debounced() {
    var args = arguments;
    return new Promise(function(resolve){
      queue.push([this, args, resolve]);
      if (working < count) work();
    }.bind(this));
  }
}
