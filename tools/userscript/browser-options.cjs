function chromiumLaunchOptions(extra = {}) {
  const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH;
  const channel = process.env.PLAYWRIGHT_CHROMIUM_CHANNEL;

  return {
    ...extra,
    ...(executablePath ? { executablePath } : {}),
    ...(channel && !executablePath ? { channel } : {})
  };
}

module.exports = {
  chromiumLaunchOptions
};

