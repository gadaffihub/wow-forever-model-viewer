import Cocoa
@preconcurrency import WebKit

final class Viewer: NSObject, NSApplicationDelegate, WKNavigationDelegate, WKDownloadDelegate {
    var window: NSWindow!
    var webView: WKWebView!
    var process: Process?
    var attempts = 0
    var projectURL: URL { Bundle.main.bundleURL.deletingLastPathComponent() }
    var nodePath: String? {
        let candidates = ["/opt/homebrew/bin/node", "/usr/local/bin/node"] + (ProcessInfo.processInfo.environment["PATH"] ?? "").split(separator: ":").map { String($0) + "/node" }
        return candidates.first { FileManager.default.isExecutableFile(atPath: $0) }
    }
    var serverURL: URL { URL(string: Bundle.main.object(forInfoDictionaryKey: "ViewerURL") as? String ?? "http://127.0.0.1:4317")! }
    func applicationDidFinishLaunching(_ notification: Notification) {
        let menu = NSMenu()
        let appItem = NSMenuItem(); menu.addItem(appItem)
        let appMenu = NSMenu()
        let choose = appMenu.addItem(withTitle: "Choose WoW beta installation…", action: #selector(chooseInstallation), keyEquivalent: "o"); choose.target = self
        appMenu.addItem(.separator()); appMenu.addItem(withTitle: "Quit WoW Models", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q"); appItem.submenu = appMenu
        let editItem = NSMenuItem(); menu.addItem(editItem)
        let editMenu = NSMenu(title: "Edit")
        for (name, selector, key) in [("Copy", "copy:", "c"), ("Paste", "paste:", "v"), ("Select All", "selectAll:", "a")] { editMenu.addItem(withTitle: name, action: Selector(selector), keyEquivalent: key) }
        editItem.submenu = editMenu; NSApp.mainMenu = menu
        window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 1380, height: 920), styleMask: [.titled, .closable, .miniaturizable, .resizable], backing: .buffered, defer: false)
        window.title = "WoW Models"; window.backgroundColor = .black; window.minSize = NSSize(width: 900, height: 600)
        webView = WKWebView(frame: window.contentView!.bounds); webView.autoresizingMask = [.width, .height]; webView.navigationDelegate = self
        window.contentView!.addSubview(webView); window.center(); window.makeKeyAndOrderFront(nil); NSApp.activate(ignoringOtherApps: true)
        connect()
    }
    func connect() {
        URLSession.shared.dataTask(with: serverURL.appendingPathComponent("api/status")) { [weak self] data, response, error in
            DispatchQueue.main.async {
                guard let self = self else { return }
                if let response = response as? HTTPURLResponse, response.statusCode == 200 {
                    self.webView.load(URLRequest(url: self.serverURL)); return
                }
                if self.process == nil && self.attempts == 0 { self.startServer() }
                self.attempts += 1
                if self.attempts < 30 { DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) { self.connect() } }
                else { self.showError("The local viewer could not start. Open .cache/viewer.log in the project folder for details.") }
            }
        }.resume()
    }
    func startServer() {
        let root = projectURL
        guard let node = nodePath else { showError("Node.js 22 or newer is required. Follow the installation guide in README.md."); return }
        let task = Process(); task.executableURL = URL(fileURLWithPath: node); task.arguments = [root.appendingPathComponent("server/index.js").path]; task.currentDirectoryURL = root
        task.environment = ProcessInfo.processInfo.environment; task.environment?["PORT"] = String(serverURL.port ?? 4317)
        let logURL = root.appendingPathComponent(".cache/viewer.log")
        try? FileManager.default.createDirectory(at: logURL.deletingLastPathComponent(), withIntermediateDirectories: true)
        FileManager.default.createFile(atPath: logURL.path, contents: nil)
        if let log = try? FileHandle(forWritingTo: logURL) { task.standardOutput = log; task.standardError = log }
        do { try task.run(); process = task } catch { showError(error.localizedDescription) }
    }
    @objc func chooseInstallation() {
        let panel = NSOpenPanel(); panel.title = "Choose WoW beta installation"
        panel.message = "Choose World of Warcraft or its _classic_beta_ folder. The installation must contain the Forever Beta."
        panel.canChooseDirectories = true; panel.canChooseFiles = false; panel.allowsMultipleSelection = false
        panel.beginSheetModal(for: window) { [weak self] response in
            guard let self = self, response == .OK, let folder = panel.url else { return }
            guard let node = self.nodePath else { self.showError("Node.js 22 or newer is required."); return }
            let task = Process(), output = Pipe()
            task.executableURL = URL(fileURLWithPath: node)
            task.arguments = [self.projectURL.appendingPathComponent("scripts/configure.js").path, folder.path]
            task.currentDirectoryURL = self.projectURL; task.standardOutput = output; task.standardError = output
            task.terminationHandler = { [weak self] result in
                let text = String(data: output.fileHandleForReading.readDataToEndOfFile(), encoding: .utf8) ?? "Configuration failed."
                DispatchQueue.main.async {
                    guard let self = self else { return }
                    guard result.terminationStatus == 0 else { self.showError(text); return }
                    if let server = self.process {
                        if server.isRunning { server.terminate(); server.waitUntilExit() }
                        self.process = nil; self.attempts = 0; self.connect()
                    } else { self.showError("Installation saved. Restart the viewer server running in Terminal to apply it.") }
                }
            }
            do { try task.run() } catch { self.showError(error.localizedDescription) }
        }
    }
    func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        decisionHandler(navigationAction.shouldPerformDownload ? .download : .allow)
    }
    func webView(_ webView: WKWebView, navigationAction: WKNavigationAction, didBecome download: WKDownload) { download.delegate = self }
    func download(_ download: WKDownload, decideDestinationUsing response: URLResponse, suggestedFilename: String, completionHandler: @escaping (URL?) -> Void) {
        var destination = FileManager.default.urls(for: .downloadsDirectory, in: .userDomainMask)[0].appendingPathComponent(suggestedFilename)
        if FileManager.default.fileExists(atPath: destination.path) { destination = destination.deletingLastPathComponent().appendingPathComponent(UUID().uuidString + "-" + suggestedFilename) }
        completionHandler(destination)
    }
    func showError(_ message: String) { let alert = NSAlert(); alert.messageText = "WoW Models"; alert.informativeText = message; alert.runModal() }
    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { true }
    func applicationWillTerminate(_ notification: Notification) { if let process = process, process.isRunning { process.terminate() } }
}
let app = NSApplication.shared
app.setActivationPolicy(.regular)
let delegate = Viewer(); app.delegate = delegate
app.run()
