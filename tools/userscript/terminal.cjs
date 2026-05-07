function waitForEnter() {
  return new Promise((resolve) => {
    const onData = () => {
      process.stdin.pause();
      resolve();
    };

    process.stdin.resume();
    process.stdin.once('data', onData);
  });
}

module.exports = {
  waitForEnter
};

