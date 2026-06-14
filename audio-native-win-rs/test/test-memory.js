/* eslint-disable @typescript-eslint/explicit-function-return-type */
/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require('assert');
const { AudioNativeWin } = require('../dist/index.js');

const initialMemory = process.memoryUsage.rss();
console.log(`Initial memory: ${initialMemory / 1024 / 1024}MB`);

const iterations = 10000;
for (let i = 1; i <= iterations; i++) {
  const sessions = AudioNativeWin.getAllSessions();
  sessions.forEach((session) => session.cleanup());
  
  if (i % 2500 === 0) {
    global.gc();
    console.log(`Iteration ${i}, RSS: ${process.memoryUsage.rss() / 1024 / 1024}MB`);
  }
}

global.gc();

const endMemory = process.memoryUsage.rss();
const diff = endMemory - initialMemory;
console.log(`Final memory: ${endMemory / 1024 / 1024}MB`);
console.log(`Diff: ${diff / 1024 / 1024}MB`);

assert(
  Math.abs(diff) < 100 * 1024 * 1024,
  `Memory leak detected, ${Math.abs(diff) / 1024 / 1024}MB`,
);
