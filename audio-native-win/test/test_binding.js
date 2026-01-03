const assert = require('assert');
const AudioNativeWin = require('../dist/binding.js').default;

assert(AudioNativeWin, 'The expected module is undefined');

function testBasic() {
  console.log(AudioNativeWin);
  assert(AudioNativeWin.getProcessVolume, 'The expected method is not defined');
  const sessions = AudioNativeWin.getAllSessions();
  console.log(
    sessions.map((s) => ({
      pid: s.pid,
      name: s.name,
    })),
  );
}

assert.doesNotThrow(testBasic, undefined, 'testBasic threw an expection');

console.log('Tests passed- everything looks OK!');
