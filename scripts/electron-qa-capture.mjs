// Minimized native Electron windows have no drawable screenshot surface.
// Restore only the isolated QA window before asking Playwright to capture it.
export async function captureElectron(application, page, options) {
  await application.evaluate(({ BrowserWindow }) => {
    const window = BrowserWindow.getAllWindows()[0]
    if (window.isMinimized()) window.restore()
    window.show()
    window.focus()
  })
  await page.bringToFront()
  await page.screenshot(options)
}
